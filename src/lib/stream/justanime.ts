/**
 * JustAnime resolver (https://justanime.to).
 *
 * Clean REST API on `core.justanime.to/api` — returns DIRECT m3u8 + VTT:
 *
 *   GET /watch/{anilistId}/episode/{ep}/availability
 *     → { servers: { megaplay: { sub, dub }, anineko: { sub, hsub, dub },
 *                    animegg: {…}, anisnatch-*: {…} } }
 *   GET /watch/{anilistId}/episode/{ep}/{provider}[/{audio}]
 *     → { sub: { sources:[{url,quality,isM3U8}], subtitles:[{file,label,kind}],
 *                intro, outro, headers:{Referer} },
 *         dub: { … } }
 *
 * Providers observed: megaplay, anineko, animegg, anisnatch-{baka,vibe,pain,cero,xoro}
 * The AniList id is used directly, so no title search is needed.
 */

import { TtlCache } from "@/lib/lru";

const API = "https://core.justanime.to/api";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Providers we ask for, in preference order. */
const PROVIDERS = ["megaplay", "anineko", "animegg"] as const;

export type JaServer = {
  name: string;
  type: "sub" | "hsub" | "dub";
  hls: string | null;
  vtt: { label: string; url: string }[];
  referer: string | null;
  provider: string;
};

type JaSource = { url?: string; quality?: string; isM3U8?: boolean };
type JaTrack = { file?: string; label?: string; kind?: string };
type JaSide = {
  sources?: JaSource[];
  subtitles?: JaTrack[];
  headers?: { Referer?: string };
} | null;
type JaProviderResp = { sub?: JaSide; dub?: JaSide; error?: string };

type JaAvailability = {
  servers?: Record<string, Record<string, boolean>>;
};

const g = globalThis as unknown as {
  __na_ja?: TtlCache<JaServer[]>;
};
const cache: TtlCache<JaServer[]> = (g.__na_ja ??= new TtlCache<JaServer[]>(120));

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Origin: "https://justanime.to",
        Referer: "https://justanime.to/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Human label for a provider slug. */
function labelFor(provider: string, audio: string): string {
  const p = provider.replace(/^anisnatch-/, "");
  const map: Record<string, string> = {
    megaplay: "Megaplay",
    anineko: "Anivibe",
    animegg: "Vidwish",
    baka: "OkCDN",
    vibe: "Vidplay",
    pain: "Mp4",
    cero: "AniYT",
    xoro: "Nekovibe",
  };
  const base = map[p] ?? p.replace(/^\w/, (c) => c.toUpperCase());
  return audio === "dub" ? `${base} Dub` : base;
}

export async function resolveJustAnime(
  anilistId: number,
  ep: number,
): Promise<JaServer[]> {
  const key = `ja:${anilistId}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: JaServer[], ok: boolean) => {
    cache.set(key, data, ok ? 25 * 60_000 : 5 * 60_000);
    return data;
  };

  // 1. Which providers actually have this episode?
  const avail = await getJson<JaAvailability>(
    `/watch/${anilistId}/episode/${ep}/availability`,
  );
  const servers = avail?.servers;
  if (!servers) return done([], false);

  // 2. Query every available provider in parallel.
  const jobs: Promise<JaServer[]>[] = [];

  for (const provider of Object.keys(servers)) {
    // Skip the anisnatch mirrors — they are embed-only and frequently dead.
    if (provider.startsWith("anisnatch-")) continue;

    const caps = servers[provider];
    if (!caps) continue;

    const wantSub = caps.sub === true;
    const wantHsub = caps.hsub === true;
    const wantDub = caps.dub === true;
    if (!wantSub && !wantHsub && !wantDub) continue;

    jobs.push(
      (async () => {
        const data = await getJson<JaProviderResp>(
          `/watch/${anilistId}/episode/${ep}/${provider}`,
        );
        if (!data || data.error) return [];

        const out: JaServer[] = [];
        const referer = data.sub?.headers?.Referer ?? null;

        const pushSide = (side: JaSide, type: JaServer["type"]) => {
          if (!side?.sources?.length) return;
          const hls =
            side.sources.find((s) => s.isM3U8 && s.url)?.url ??
            side.sources[0]?.url ??
            null;
          if (!hls) return;
          const vtt = (side.subtitles ?? [])
            .filter((t) => (t.kind === "captions" || t.kind === "subtitles" || !t.kind) && t.file)
            .map((t) => ({ label: t.label || "English", url: t.file as string }));
          out.push({
            name: labelFor(provider, type),
            type,
            hls,
            vtt,
            referer: side.headers?.Referer ?? referer,
            provider,
          });
        };

        if (wantSub) pushSide(data.sub ?? null, "sub");
        // hsub shares the sub payload on this provider family
        if (wantHsub) pushSide(data.sub ?? null, "hsub");
        if (wantDub) pushSide(data.dub ?? null, "dub");
        return out;
      })(),
    );
  }

  const settled = await Promise.all(jobs);
  const all = settled.flat();

  // 3. Validate every HLS link so dead pills never reach the UI.
  const validated = await Promise.all(
    all.map(async (srv) => {
      if (!srv.hls) return srv;
      const ok = await isPlayable(srv.hls, srv.referer ?? "https://megaplay.buzz/");
      return ok ? srv : { ...srv, hls: null };
    }),
  );

  const usable = validated.filter((s) => s.hls);
  return done(usable, usable.length > 0);
}

async function isPlayable(hlsUrl: string, referer: string): Promise<boolean> {
  for (const attempt of [0, 1]) {
    try {
      const res = await fetch(hlsUrl, {
        method: attempt === 0 ? "HEAD" : "GET",
        headers: {
          "User-Agent": UA,
          Accept: "application/vnd.apple.mpegurl,*/*",
          Referer: referer,
        },
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        if (attempt === 0) return true;
        const text = await res.text().catch(() => "");
        return text.includes("#EXTM3U");
      }
      if (res.status !== 404 && res.status !== 410) return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}
