/**
 * Shiro resolver (https://shiro.so).
 *
 * Replaces the retired AniBD provider. Single POST, id-based (no title search),
 * and returns everything the player needs in one round trip:
 *
 *   POST https://shiro.so/api/episode  { anilistId, malId, episode }
 *     → { status: "ready", variants: [{ id, label, sources: [...] }] }
 *
 *   variant.id  "sub" | "dub" | "hsub"
 *   source      { id, label, url, type, tracks: [] }
 *     type  "application/vnd.apple.mpegurl" → multi-quality master (360/480/720/1080)
 *          "video/mp4"                      → progressive single file
 *     url    origin-relative "/stream/{token}/index.m3u8" | "/file"
 *   track       { id, src, type: "vtt", label, language, default }
 *
 * Streams are same-origin on shiro.so and need NO Referer, so the proxy
 * default policy works unchanged. English VTT ships alongside the video, so
 * the Gemini translate pipeline works out of the box.
 */

import { TtlCache } from "@/lib/lru";

const ORIGIN = "https://shiro.so";
const EPISODE_API = `${ORIGIN}/api/episode`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Shiro serves its own media, so a self-referer is always safe. */
export const SHIRO_REFERER = `${ORIGIN}/`;

export type ShiroServer = {
  name: string;
  type: "sub" | "dub" | "hsub";
  hls: string | null;
  vtt: { label: string; url: string }[];
  referer: string;
};

type ShiroTrack = {
  id?: string;
  src?: string;
  type?: string;
  label?: string;
  language?: string;
  default?: boolean;
};

type ShiroSource = {
  id?: string;
  label?: string;
  url?: string;
  type?: string;
  tracks?: ShiroTrack[];
};

type ShiroVariant = {
  id?: string;
  label?: string;
  sources?: ShiroSource[];
};

type ShiroResponse = {
  status?: string;
  variants?: ShiroVariant[];
};

const g = globalThis as unknown as { __na_shiro?: TtlCache<ShiroServer[]> };
const cache: TtlCache<ShiroServer[]> = (g.__na_shiro ??= new TtlCache<ShiroServer[]>(200));

/** Turn an origin-relative "/stream/…" into an absolute shiro.so URL. */
function absolute(raw: string): string {
  if (raw.startsWith("http")) return raw;
  return ORIGIN + (raw.startsWith("/") ? raw : `/${raw}`);
}

function variantType(id: string): ShiroServer["type"] {
  const v = id.toLowerCase();
  if (v === "dub") return "dub";
  if (v === "hsub" || v === "hardsub" || v === "hard") return "hsub";
  return "sub";
}

async function postEpisode(
  anilistId: number,
  ep: number,
  timeoutMs: number,
): Promise<ShiroResponse | null> {
  try {
    const res = await fetch(EPISODE_API, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: ORIGIN,
        Referer: `${ORIGIN}/`,
      },
      body: JSON.stringify({ anilistId, malId: null, episode: ep }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as ShiroResponse;
  } catch {
    return null;
  }
}

/**
 * Shiro's own "Cherry" MP4 is single-file; the HLS masters are multi-quality.
 * Both are offered, HLS first so the quality selector is populated.
 */
function isPlayable(url: string): boolean {
  return /\.(m3u8)(\?|$)/i.test(url) || /\/file(\?|$)/i.test(url);
}

export async function resolveShiro(anilistId: number, ep: number): Promise<ShiroServer[]> {
  const key = `shiro:${anilistId}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: ShiroServer[], ok: boolean) => {
    cache.set(key, data, ok ? 25 * 60_000 : 5 * 60_000);
    return data;
  };

  const json = await postEpisode(anilistId, ep, 12_000);
  if (!json || json.status !== "ready" || !Array.isArray(json.variants)) {
    return done([], false);
  }

  const out: ShiroServer[] = [];
  for (const variant of json.variants) {
    const type = variantType(String(variant.id ?? "sub"));
    const sources = Array.isArray(variant.sources) ? variant.sources : [];

    // HLS first, then progressive MP4 — keeps the quality menu meaningful.
    const ordered = [...sources].sort((a, b) => {
      const ah = /mpegurl|m3u8/i.test(`${a.type ?? ""} ${a.url ?? ""}`) ? 0 : 1;
      const bh = /mpegurl|m3u8/i.test(`${b.type ?? ""} ${b.url ?? ""}`) ? 0 : 1;
      return ah - bh;
    });

    for (const source of ordered) {
      if (!source.url) continue;
      const url = absolute(source.url);
      if (!isPlayable(url)) continue;

      const tracks: { label: string; url: string }[] = [];
      for (const t of source.tracks ?? []) {
        if (!t.src) continue;
        if (!/vtt/i.test(t.type ?? "vtt")) continue;
        tracks.push({
          label: t.label || t.language || "English",
          url: absolute(t.src),
        });
      }
      // English first so the translate bar picks it up automatically.
      tracks.sort((a, b) => (/eng/i.test(a.label) ? 0 : 1) - (/eng/i.test(b.label) ? 0 : 1));

      out.push({
        name: source.label?.trim() || "Shiro",
        type,
        hls: url,
        vtt: tracks,
        referer: SHIRO_REFERER,
      });
    }
  }

  return done(out, out.length > 0);
}
