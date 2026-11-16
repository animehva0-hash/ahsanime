import { TtlCache } from "@/lib/lru";

const BASE = "https://hianime.at";
const API = `${BASE}/api/theme`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type HiServer = {
  name: string;
  type: "sub" | "dub";
  embedUrl: string;
  /** Direct HLS when the embed could be resolved, else null (embed fallback). */
  hls: string | null;
  /** Subtitle tracks extracted from the embed page, if any. */
  vtt: { label: string; url: string }[];
};

type SearchHit = { slug: string; animeId: string; score: number };

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function similarity(candidate: string, wanted: string): number {
  const c = norm(candidate);
  const w = norm(wanted);
  if (!c || !w) return 0;
  if (c === w) return 100;
  if (c.startsWith(w) || w.startsWith(c)) return 80;
  if (c.includes(w) || w.includes(c)) return 60;
  return 0;
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  const body = await getText(url);
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

async function search(query: string): Promise<SearchHit[]> {
  const html = await getText(`${BASE}/search?keyword=${encodeURIComponent(query)}`);
  if (!html) return [];

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const re = /href="(?:https:\/\/hianime\.at)?\/watch\/([a-z0-9-]+)"([\s\S]{0,500}?data-id="(\d+)")/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < 40) {
    const slug = match[1];
    const animeId = match[3];
    if (seen.has(animeId)) continue;
    seen.add(animeId);
    const title = /title="([^"<>]{2,120})"/.exec(match[2])?.[1] ?? slug;
    hits.push({ slug, animeId, score: Math.max(similarity(title, query), similarity(slug, query) * 0.9) });
  }
  return hits.sort((a, b) => b.score - a.score);
}

function decodeHash(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return /^https:\/\//.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

const g = globalThis as unknown as { __na_hianime?: TtlCache<HiServer[]> };
const cache: TtlCache<HiServer[]> = (g.__na_hianime ??= new TtlCache<HiServer[]>(120));

export async function resolveHiAnime(params: {
  romaji: string;
  english?: string | null;
  synonyms?: string[] | null;
  ep: number;
}): Promise<HiServer[]> {
  const titles = [...new Set([params.romaji, params.english ?? "", ...(params.synonyms ?? [])].filter(Boolean))];
  const key = `v1:${titles.join("|")}:${params.ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const searches = await Promise.all(titles.map((title) => search(title)));
  const candidates = new Map<string, SearchHit>();
  for (const list of searches) {
    for (const candidate of list) {
      const previous = candidates.get(candidate.animeId);
      if (!previous || candidate.score > previous.score) candidates.set(candidate.animeId, candidate);
    }
  }

  let episodeId: string | null = null;
  for (const candidate of [...candidates.values()].slice(0, 12)) {
    const data = await getJson<{ html?: string }>(`${API}/episode/list/${candidate.animeId}`);
    const html = data?.html ?? "";
    const escaped = html.replace(/\\"/g, '"');
    const re = /data-number="(\d+)"[\s\S]{0,140}?data-id="(\d+)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(escaped))) {
      if (Number(match[1]) === params.ep) {
        episodeId = match[2];
        break;
      }
    }
    if (episodeId) break;
  }

  if (!episodeId) {
    cache.set(key, [], 5 * 60_000);
    return [];
  }

  const data = await getJson<{ html?: string }>(`${API}/episode/servers?episodeId=${episodeId}`);
  const html = data?.html ?? "";
  const servers: HiServer[] = [];
  const seen = new Set<string>();
  const re = /data-hash="([A-Za-z0-9+/=]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const embedUrl = decodeHash(match[1]);
    if (!embedUrl || seen.has(embedUrl)) continue;
    seen.add(embedUrl);
    const type: HiServer["type"] = /\/(dub)(?:\?|$)/i.test(embedUrl) ? "dub" : "sub";

    // Try to resolve the embed → direct HLS + subtitle tracks.
    // This makes subtitles available even on mobile where iframe embeds
    // may block caption tracks or fail to load them.
    const resolved = await resolveEmbed(embedUrl);

    servers.push({
      name: embedUrl.includes("zokoanime") ? "ZokoAnime" : "Megaplay",
      type,
      embedUrl,
      hls: resolved?.hls ?? null,
      vtt: resolved?.vtt ?? [],
    });
  }

  cache.set(key, servers, servers.length ? 25 * 60_000 : 5 * 60_000);
  return servers;
}

const OBF_KEY = "otaku-embed-v1";

/** Deobfuscate ZokoAnime's window.__P blob into a player config object. */
function deobfuscateZokoP(blob: string): any | null {
  try {
    const binary = Buffer.from(blob, "base64").toString("binary");
    let out = "";
    for (let i = 0; i < binary.length; i++) {
      out += String.fromCharCode(binary.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length));
    }
    return JSON.parse(decodeURIComponent(escape(out)));
  } catch {
    return null;
  }
}

/**
 * Fetch an embed page and extract direct HLS + subtitle VTT URLs.
 * Supports ZokoAnime (XOR-obfuscated __P blob) and generic embeds by
 * scanning for <track> tags or JS config variables.
 */
async function resolveEmbed(
  embedUrl: string,
): Promise<{ hls: string | null; vtt: { label: string; url: string }[] } | null> {
  let origin = "";
  try {
    origin = new URL(embedUrl).origin;
  } catch {
    return null;
  }

  // ZokoAnime embeds are served from HiAnime's server list — they may require
  // the HiAnime referer. Megaplay embeds need their own origin as referer.
  const referer = embedUrl.includes("zokoanime")
    ? "https://hianime.at/"
    : `${origin}/`;

  const res = await fetch(embedUrl, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml,*/*",
      Referer: referer,
      Origin: referer.endsWith("/") ? referer.slice(0, -1) : referer,
    },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);

  if (!res || !res.ok) return null;
  const html = await res.text().catch(() => "");
  if (!html) return null;

  // --- ZokoAnime: deobfuscate window.__P → { src, subtitles: [...] } ---
  const pMatch = /window\.__P\s*=\s*"([^"]{20,})"/i.exec(html);
  if (pMatch) {
    const cfg = deobfuscateZokoP(pMatch[1]);
    if (cfg && typeof cfg === "object") {
      const hls = typeof cfg.src === "string" ? cfg.src : null;
      const vtt: { label: string; url: string }[] = [];
      if (Array.isArray(cfg.subtitles)) {
        for (const t of cfg.subtitles) {
          if (typeof t?.src === "string" && typeof t?.label === "string") {
            vtt.push({ label: t.label, url: t.src });
          }
        }
      }
      vtt.sort(
        (a, b) =>
          (/english|\beng\b/i.test(a.label) ? 0 : 1) -
          (/english|\beng\b/i.test(b.label) ? 0 : 1),
      );
      if (!hls && vtt.length === 0) return null;
      return { hls, vtt };
    }
  }

  // --- Generic: extract HLS from common JS/HTML patterns ---
  // Patterns: src="...", file: "...", source src="..."
  const hlsMatch =
    /["']file["']\s*:\s*["']([^"']*\.m3u8[^"']*)["']/i.exec(html) ||
    /src=["']([^"']*\.m3u8[^"']*)["']/i.exec(html) ||
    /hls\s*[:=]\s*["']([^"']*\.m3u8[^"']*)["']/i.exec(html);

  let hls: string | null = null;
  if (hlsMatch) {
    const raw = hlsMatch[1];
    hls = raw.startsWith("http") ? raw : new URL(raw, embedUrl).toString();
  }

  // --- Extract subtitle tracks from <track> tags and JS configs ---
  const vtt: { label: string; url: string }[] = [];

  // <track kind="captions" src="..." label="...">
  const trackRe = /<track[^>]*kind=["']captions["'][^>]*>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = trackRe.exec(html))) {
    const tag = tm[0];
    const srcMatch = /src=["']([^"']+)["']/i.exec(tag);
    const labelMatch = /label=["']([^"']*)["']/i.exec(tag);
    if (srcMatch) {
      const raw = srcMatch[1];
      const url = raw.startsWith("http") ? raw : new URL(raw, embedUrl).toString();
      if (/\.vtt(\?|$)/i.test(url)) {
        vtt.push({ label: labelMatch?.[1] || "English", url });
      }
    }
  }

  // JS config: tracks: [{ file: "...", label: "..." }]
  const jsTrackRe = /tracks\s*[:=]\s*\[([\s\S]{0,2000}?)\]/i.exec(html);
  if (jsTrackRe) {
    const trackStr = jsTrackRe[1];
    const jsTrackItemRe = /file["']?\s*:\s*["']([^"']+)["'][\s\S]{0,200}?label["']?\s*:\s*["']([^"']*)["']/gi;
    let jm: RegExpExecArray | null;
    while ((jm = jsTrackItemRe.exec(trackStr))) {
      const raw = jm[1];
      const url = raw.startsWith("http") ? raw : new URL(raw, embedUrl).toString();
      if (/\.vtt(\?|$)/i.test(url) && !vtt.some((v) => v.url === url)) {
        vtt.push({ label: jm[2] || "English", url });
      }
    }
  }

  vtt.sort(
    (a, b) =>
      (/english|\beng\b/i.test(a.label) ? 0 : 1) -
      (/english|\beng\b/i.test(b.label) ? 0 : 1),
  );

  if (!hls && vtt.length === 0) return null;
  return { hls, vtt };
}