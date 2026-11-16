import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure-schema";
import { anilistStats } from "@/lib/anilist";
import { isGeminiConfigured, translateModel } from "@/lib/stream/gemini";
import { queueStats } from "@/lib/stream/queue";
import { sessionStats } from "@/lib/stream/session-store";

export const dynamic = "force-dynamic";

type Check = { name: string; ok: boolean; detail?: string; ms?: number };

async function timed(name: string, fn: () => Promise<string | void>): Promise<Check> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, detail: detail || undefined, ms: Date.now() - t0 };
  } catch (e) {
    return {
      name,
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 120) : "failed",
      ms: Date.now() - t0,
    };
  }
}

/**
 * Health endpoint used by the platform check and by the in-app status widget.
 * Also guarantees the database tables exist (auto-create on first hit).
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";

  const checks: Check[] = [];

  checks.push(
    await timed("database", async () => {
      await ensureSchema();
      await db.execute(sql`select 1`);
      return "connected + schema ready";
    }),
  );

  checks.push({
    name: "translator",
    ok: isGeminiConfigured(),
    detail: isGeminiConfigured()
      ? `gemini · ${translateModel()}`
      : "GOOGLE_TRANSLATE_API_KEY missing",
  });

  if (deep) {
    // NOTE: this check costs ZERO AniList quota on purpose. The old code did a
    // live POST to graphql.anilist.co on every ?deep=1 hit (including uptime
    // monitors), burning the shared 30/min budget. Report local limiter +
    // circuit state instead — same signal, no quota cost.
    const s = anilistStats();
    checks.push({
      name: "anilist",
      ok: !s.circuitOpen,
      detail: s.circuitOpen
        ? `backing off ${Math.ceil(s.downForMs / 1000)}s · ${s.consec429}x refused`
        : `quota ${s.remaining} left · pace ${s.intervalMs}ms · cache ${s.cacheSize}`,
    });
    checks.push(
      await timed("anikoto", async () => {
        const res = await fetch("https://anikoto.cz/", {
          headers: { "User-Agent": "AHSANIME/1.0 healthcheck" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        return "catalog reachable";
      }),
    );
  }

  const critical = checks.find((c) => c.name === "database");
  const ok = Boolean(critical?.ok);

  return Response.json(
    {
      ok,
      status: ok ? "healthy" : "degraded",
      uptimeSec: Math.round(process.uptime()),
      checks,
      translation: { queue: queueStats(), cache: sessionStats() },
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 500 },
  );
}
