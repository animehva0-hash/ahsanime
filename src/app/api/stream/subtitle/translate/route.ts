import { fetchSubtitleCues, SubtitleFetchError } from "@/lib/stream/fetch-subtitle";
import {
  isGeminiConfigured,
  translateCues,
  translateModel,
  TranslationError,
  TRANSLATE_PROVIDER,
} from "@/lib/stream/gemini";
import { applyReplacements, stripRemainingEnglish } from "@/lib/stream/replacements";
import { mergeOverlappingCues, normaliseGlyphs, toVtt } from "@/lib/stream/vtt";
import { enqueue, runDedup } from "@/lib/stream/queue";
import {
  getTranslation,
  purgeSession,
  putTranslation,
} from "@/lib/stream/session-store";
import { languageFor } from "@/lib/stream/languages";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const vttHeaders = { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-store" };

/**
 * GET /api/stream/subtitle/translate?url=...&lang=...&animeId=...&ep=...&sessionId=...
 *
 * 1. Parse the English VTT cues
 * 2. Translate cue batches with Gemini structured JSON (queued, max 2 jobs)
 * 3. Apply line replacements, then word replacements
 * 4. Return a valid temporary VTT (cached per session for 10 minutes)
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const url = sp.get("url") ?? "";
  const lang = sp.get("lang") ?? "";
  const animeId = sp.get("animeId") ?? "";
  const ep = sp.get("ep") ?? "";
  const sessionId = sp.get("sessionId") ?? "";

  if (!url || !lang || !animeId || !ep || !sessionId) {
    return Response.json(
      { ok: false, error: "url, lang, animeId, ep and sessionId are required" },
      { status: 400 },
    );
  }
  if (!languageFor(lang)) {
    return Response.json({ ok: false, error: `Unknown language: ${lang}` }, { status: 400 });
  }

  // Per-IP abuse guard (translation is expensive).
  const rl = rateLimit(`tr:${clientIp(req)}`, 12, 60_000);
  if (!rl.ok) {
    return Response.json(
      { ok: false, code: "rate_limited", error: "Too many translations — try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetInMs / 1000)) } },
    );
  }

  // Validate inputs before any upstream work.
  const safeUrl = (() => {
    try {
      const u = new URL(decodeURIComponent(url));
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  })();
  if (!safeUrl) {
    return Response.json({ ok: false, error: "Invalid subtitle URL" }, { status: 400 });
  }

  const configured = isGeminiConfigured();
  if (!configured) {
    return Response.json(
      {
        ok: false,
        code: "not_configured",
        provider: TRANSLATE_PROVIDER,
        model: translateModel(),
        configured: false,
        error:
          "Translation is not configured (missing GOOGLE_TRANSLATE_API_KEY). Original English captions remain available.",
      },
      { status: 503 },
    );
  }

  // Session cache hit → instant VTT.
  const cached = getTranslation(sessionId, animeId, ep, lang);
  if (cached) return new Response(cached.vtt, { status: 200, headers: vttHeaders });

  try {
    // Multi-user safety: identical in-flight translations share one job.
    const jobKey = `${sessionId}:${animeId}:${ep}:${lang}:${url}`;
    const vttText = await runDedup(jobKey, () =>
      enqueue(async () => {
        const { cues } = await fetchSubtitleCues(decodeURIComponent(url));
        // Timing safety: collapse overlapping sign/dialogue cues BEFORE
        // translating so the output can never drift out of sync.
        const safeCues = mergeOverlappingCues(cues);
        const translated = await translateCues(safeCues, lang);
        // Post-processing: full-line corrections, then whole-word corrections,
        // then a final sweep that strips any English words still lingering.
        const polished = translated.map((c) => ({
          ...c,
          text: normaliseGlyphs(
            lang === "hinglish"
              ? applyReplacements(c.text)
              : stripRemainingEnglish(applyReplacements(c.text)),
          ),
        }));
        return toVtt(polished);
      }),
    );

    putTranslation(sessionId, animeId, ep, { vtt: vttText, lang, sourceUrl: url });
    return new Response(vttText, { status: 200, headers: vttHeaders });
  } catch (e) {
    const isTE = e instanceof TranslationError;
    const isFE = e instanceof SubtitleFetchError;
    const status = isTE ? e.status : isFE ? e.status : 500;
    return Response.json(
      {
        ok: false,
        provider: TRANSLATE_PROVIDER,
        model: translateModel(),
        code: isTE ? e.code : "fetch_failed",
        error: e instanceof Error ? e.message : "Translation failed",
      },
      { status },
    );
  }
}

/**
 * DELETE /api/stream/subtitle/translate?sessionId=...&animeId=...&ep=...
 * Page-exit cleanup; without animeId/ep it purges the whole session.
 */
export async function DELETE(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sessionId = sp.get("sessionId") ?? "";
  const animeId = sp.get("animeId");
  const ep = sp.get("ep");
  if (!sessionId) {
    return Response.json({ ok: false, error: "sessionId is required" }, { status: 400 });
  }
  const removed = purgeSession(sessionId, animeId ?? undefined, ep ?? undefined);
  return Response.json({ ok: true, removed });
}