/**
 * Gemini (AI Studio) structured subtitle translation.
 *
 * Env:
 *   GOOGLE_TRANSLATE_API_KEY   - AI Studio key, read server-side only
 *   GEMINI_TRANSLATE_MODEL     - defaults to gemini-3.5-flash-lite
 *
 * - Structured JSON output (responseSchema) — no numbered-line parsing issues
 * - Batches of cues per request to keep completions precise
 * - 408/429/5xx retried up to 3 total attempts with 3s / 6s / 9s backoff
 * - Concurrent batch groups for faster throughput within rate limits
 */

import { runtimeConfig } from "@/lib/runtime-config";
import { languageFor, type SubtitleLanguage } from "./languages";
import type { VttCue } from "./vtt";

export const TRANSLATE_PROVIDER = "gemini";

export function translateModel(): string {
  return runtimeConfig("GEMINI_TRANSLATE_MODEL") || "gemini-3.5-flash-lite";
}

/** Model fallback chain — env choice first, then known-live lite/flash models. */
function modelChain(): string[] {
  const chain = [
    translateModel(),
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash",
    "gemini-flash-latest",
  ];
  return [...new Set(chain)];
}

export function isGeminiConfigured(): boolean {
  return Boolean(runtimeConfig("GOOGLE_TRANSLATE_API_KEY"));
}

export class TranslationError extends Error {
  status: number;
  code: "not_configured" | "provider_error" | "rate_limited" | "bad_response";
  constructor(
    message: string,
    code: TranslationError["code"],
    status = 500,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  promptFeedback?: { blockReason?: string };
};

async function callGemini(
  system: string,
  userPayload: string,
  attempt = 0,
  modelIdx = 0,
): Promise<string> {
  const key = runtimeConfig("GOOGLE_TRANSLATE_API_KEY") ?? "";
  const models = modelChain();
  const model = models[Math.min(modelIdx, models.length - 1)];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userPayload }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      // Thinking models default to long budgets → cap it for subtitle latency.
      ...(model.includes("3.5") ? { thinkingConfig: { thinkingBudget: 256 } } : {}),
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "INTEGER" },
            text: { type: "STRING" },
          },
          required: ["id", "text"],
        },
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    if (attempt < 3) {
      await sleep(3000 * (attempt + 1)); // 3s/6s/9s
      return callGemini(system, userPayload, attempt + 1, modelIdx);
    }
    throw new TranslationError(
      `Gemini unreachable: ${e instanceof Error ? e.message : "network error"}`,
      "provider_error",
      502,
    );
  }

  // Model unavailable → fall back down the model chain.
  if (res.status === 404 && modelIdx + 1 < models.length) {
    return callGemini(system, userPayload, 0, modelIdx + 1);
  }

  if (res.status === 408 || res.status === 429 || res.status >= 500) {
    if (attempt < 3) {
      await sleep(3000 * (attempt + 1)); // 3s, 6s, 9s
      return callGemini(system, userPayload, attempt + 1, modelIdx);
    }
    throw new TranslationError(
      res.status === 429 ? "Gemini rate limited" : `Gemini error ${res.status}`,
      res.status === 429 ? "rate_limited" : "provider_error",
      res.status,
    );
  }

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new TranslationError(
      "Gemini rejected the request (check API key/model)",
      "not_configured",
      503,
    );
  }

  if (!res.ok) throw new TranslationError(`Gemini error ${res.status}`, "provider_error", 502);

  const json = (await res.json()) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    throw new TranslationError(
      json.promptFeedback?.blockReason
        ? `Blocked by Gemini: ${json.promptFeedback.blockReason}`
        : "Empty response from Gemini",
      "bad_response",
      502,
    );
  }
  return text;
}

function buildSystemPrompt(lang: SubtitleLanguage): string {
  const base = [
    `You are a professional subtitle translation engine for anime dialogue.`,
    `Translate every subtitle cue from English to ${lang.label}${lang.native && lang.native !== lang.label ? ` (${lang.native})` : ""}.`,
    `Rules:`,
    `- You receive a JSON array: [{"id": number, "text": string}, ...].`,
    `- Return a JSON array with the SAME ids in the SAME order, with "text" translated.`,
    `- Preserve meaning, tone, emotion and punctuation style.`,
    `- Transliterate character names, fantasy terms, attack names and Japanese honorifics (-san, -kun, -chan, -sama, -sensei, -senpai) into the target script. Never leave names or terms in English.`,
    `- Translate every English word into the target language. Transliterate names, places and proper nouns into the target script. Keep punctuation and numbers as-is. Do not leave English words untranslated, but never drop or empty a cue.`,
    `- LINE STRUCTURE IS CRITICAL: if the source text has N lines, return EXACTLY N lines.`,
    `- Use a single \n between lines. Never merge two lines into one, never split one line into two.`,
    `- Keep each line under 42 characters so nothing is cut off on screen.`,
    `- Do not add quotes around dialogue, and do not add or remove trailing punctuation.`,
    `- Never translate song-title placeholders like [OP], [ED], sound tags like (laughs); adapt them naturally in the target language.`,
    `- Output ONLY valid JSON. No comments, no markdown fences.`,
  ];
  if (lang.instruction) base.push(`- ${lang.instruction}`);
  return base.join("\n");
}

/** Hard cap per subtitle line so long translations never get clipped. */
const MAX_LINE = 42;

function clampLine(line: string): string {
  if (line.length <= MAX_LINE) return line;
  // Break on the nearest space rather than mid-word.
  const words = line.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > MAX_LINE && cur) {
      out.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) out.push(cur.trim());
  return out.join("\n");
}

/** Redistribute `lines` into exactly `want` lines, respecting MAX_LINE. */
function rebalance(lines: string[], want: number): string {
  const joined = lines.join(" ").trim();
  if (want <= 1) return clampLine(joined);

  const perLine = Math.max(18, Math.ceil(joined.length / want));
  const words = joined.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine && cur && out.length < want - 1) {
      out.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) out.push(cur.trim());

  // Safety: if we still mismatch, just clamp and return.
  if (out.length !== want) return clampLine(joined);
  return out.map((l) => (l.length > MAX_LINE ? clampLine(l) : l)).join("\n");
}

const BATCH_SIZE = 120;

export async function translateCues(
  cues: VttCue[],
  langCode: string,
): Promise<VttCue[]> {
  const lang = languageFor(langCode);
  if (!lang) throw new TranslationError(`Unknown language: ${langCode}`, "bad_response", 400);
  if (lang.code === "en") return cues;
  if (!isGeminiConfigured()) {
    throw new TranslationError(
      "GOOGLE_TRANSLATE_API_KEY is not configured",
      "not_configured",
      503,
    );
  }

  const system = buildSystemPrompt(lang);
  const out: VttCue[] = [];

  async function requestBatch(batch: VttCue[]): Promise<Map<number, string>> {
    const payload = JSON.stringify(batch.map((c) => ({ id: c.id, text: c.text })));
    const raw = await callGemini(system, payload);

    let parsed: { id: number; text: string }[];
    try {
      parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("not an array");
    } catch {
      throw new TranslationError("Gemini returned malformed JSON", "bad_response", 502);
    }
    return new Map(
      parsed
        .filter((p) => typeof p?.id === "number" && typeof p?.text === "string")
        .map((p) => [p.id, p.text.trim()]),
    );
  }

  async function translateBatch(batch: VttCue[]): Promise<VttCue[]> {
    // Strict id mapping — a cue never changes its timing; any id the model
    // fails to return gets no text (never the original English line).
    let byId: Map<number, string>;
    try {
      byId = await requestBatch(batch);
    } catch {
      // A totally failed batch never leaks English: those cues stay empty
      // (no subtitle) rather than falling back to the original English line.
      return batch.map((cue) => ({ ...cue, text: "" }));
    }
    if (!byId) return batch.map((cue) => ({ ...cue, text: "" }));

    // Repair pass: re-request any cue the model failed to return, up to 3 times.
    let missing = batch.filter((c) => !byId.has(c.id));
    for (let attempt = 0; attempt < 3 && missing.length > 0; attempt++) {
      const repaired = await requestBatch(missing).catch(() => null);
      if (!repaired) break;
      for (const [id, text] of repaired) byId.set(id, text);
      const stillMissing = missing.filter((c) => !byId.has(c.id));
      if (stillMissing.length === missing.length) break;
      missing = stillMissing;
    }

    return batch.map((cue) => {
      const translated = byId.get(cue.id);
      const srcLines = cue.text.split("\n").map((l) => l.trim()).filter(Boolean);
      // Never fall back to the original English line — empty translation
      // means no subtitle for that cue, not English text.
      let text = translated && translated.length > 0 ? translated : "";

      // Enforce the source line structure so cues never overflow the screen.
      const wantLines = Math.max(1, srcLines.length);
      let outLines = text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (outLines.length === wantLines) {
        // ideal — just clamp each line's length
        text = outLines.map((l) => clampLine(l)).join("\n");
      } else if (outLines.length > wantLines) {
        // too many lines → rebalance into the source line count
        text = rebalance(outLines, wantLines);
      } else {
        // Fewer lines than the source: keep the TRANSLATION (never drop back to
        // English) and rebalance it across the original line count.
        const keep = outLines.length ? outLines : [translated ?? ""];
        text = rebalance(keep, wantLines);
      }
      return { ...cue, text };
    });
  }

  // Batches of 120 run with higher concurrency — faster while staying inside rate limits.
  const CONCURRENCY = 5;
  for (let i = 0; i < cues.length; i += BATCH_SIZE * CONCURRENCY) {
    const group: Promise<VttCue[]>[] = [];
    for (let j = 0; j < CONCURRENCY; j++) {
      const batch = cues.slice(i + j * BATCH_SIZE, i + (j + 1) * BATCH_SIZE);
      if (batch.length) group.push(translateBatch(batch));
    }
    const results = await Promise.all(group);
    for (const r of results) out.push(...r);
  }

  return out;
}