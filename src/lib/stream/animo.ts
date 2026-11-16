/**
 * AHSANIME resolver (cdn.4animo.xyz).
 *
 * Pure AniList-ID based, no title search:
 *
 *   GET /embed/hd-{1..4}/ani/{anilistId}/{ep}/{sub|dub}
 *     → HTML containing  var sourcesUrl = '/stream/getSources?t={token}'
 *   GET {sourcesUrl}
 *     → { sources:[{file:"/p?t=…", type:"hls"}],
 *         tracks:[{file:"/p?t=…", label:"English", kind:"captions"}] }
 *
 * Both `file` values are relative and must be prefixed with the CDN origin.
 * Everything is served with permissive CORS once the Referer is set, so the
 * media proxy can stream it and the VTT is translation-ready.
 */

import { TtlCache } from "@/lib/lru";

const ORIGIN = "https://cdn.4animo.xyz";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Server slugs exposed by the embed host and their display labels. */
const SERVERS = [
  { path: "hd-1", label: "AHSANIME ReHD" },
  { path: "hd-2", label: "AHSANIME HD-2" },
  { path: "hd-4", label: "AHSANIME HD-4" },
] as const;

export type AnimoServer = {
  name: string;
  type: "sub" | "dub";
  /** Direct HLS when the server could resolve it, else null (embed fallback). */
  hls: string | null;
  vtt: { label: string; url: string }[];
  server: string;
  /** Deterministic embed URL, always available. */
  embedUrl: string;
};

type AnimoSources = {
  sources?: { file?: string; type?: string }[];
  tracks?: { file?: string; label?: string; kind?: string }[];
};

const g = globalThis as unknown as { __na_animo?: TtlCache<AnimoServer[]> };
const cache: TtlCache<AnimoServer[]> = (g.__na_animo ??= new TtlCache<AnimoServer[]>(120));

async function fetchOne(
  server: { path: string; label: string },
  anilistId: number,
  ep: number,
  audio: "sub" | "dub",
): Promise<AnimoServer | null> {
  const embedUrl = `${ORIGIN}/embed/${server.path}/ani/${anilistId}/${ep}/${audio}`;
  try {
    const page = await fetch(embedUrl, {
      headers: { "User-Agent": UA, Referer: "https://indanime.co/" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!page.ok) return null;
    const html = await page.text();
    const sourcesPath = /sourcesUrl\s*=\s*'([^']+)'/.exec(html)?.[1];
    if (!sourcesPath) return null;

    // 2. token → real hls + caption tracks
    const srcRes = await fetch(`${ORIGIN}${sourcesPath}`, {
      headers: {
        "User-Agent": UA,
        Referer: embedUrl,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!srcRes.ok) return null;
    const data = (await srcRes.json()) as AnimoSources;

    const file = data.sources?.find((s) => s.file)?.file;
    if (!file) return null;
    const hls = file.startsWith("http") ? file : `${ORIGIN}${file}`;

    const vtt = (data.tracks ?? [])
      .filter((t) => t.file && (t.kind === "captions" || t.label))
      .map((t) => ({
        label: t.label || "English",
        url: t.file!.startsWith("http") ? t.file! : `${ORIGIN}${t.file}`,
      }));

    return {
      name: `${server.label}${audio === "dub" ? " Dub" : ""}`,
      type: audio,
      hls,
      vtt,
      server: server.path,
      embedUrl: embedUrl,
    };
  } catch {
    return {
      name: `${server.label}${audio === "dub" ? " Dub" : ""}`,
      type: audio,
      hls: null,
      vtt: [],
      server: server.path,
      embedUrl: embedUrl,
    };
  }
}

export async function resolveAnimo(
  anilistId: number,
  ep: number,
): Promise<AnimoServer[]> {
  const key = `animo:${anilistId}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const jobs: Promise<AnimoServer | null>[] = [];
  for (const server of SERVERS) {
    jobs.push(fetchOne(server, anilistId, ep, "sub"));
    jobs.push(fetchOne(server, anilistId, ep, "dub"));
  }
  const settled = await Promise.all(jobs);

  const seen = new Set<string>();
  const out = settled.filter((s): s is AnimoServer => {
    if (!s) return false;
    const key = s.hls ?? `${s.server}-${s.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  cache.set(key, out, out.length ? 20 * 60_000 : 5 * 60_000);
  return out;
}
