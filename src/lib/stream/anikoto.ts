import { TtlCache } from "@/lib/lru";
/**
 * Layer H — Anikoto large-catalog resolver.
 *
 * Chain:
 *   1. GET anikoto.cz/filter?keyword={title}        → internal anime id + watch url
 *   2. GET /ajax/episode/list/{internalId}          → episode token (data-ids)
 *   3. GET /ajax/server/list?servers={token}        → servers by type w/ data-link-id
 *   4. GET /ajax/server?get={linkId}                → embed url (+ skip timings)
 *   5. embed page                                   → base_url + data-id
 *   6. {base_url}/stream/getSourcesNew?id=&type=    → real HLS file + VTT tracks
 *
 * NOTE: plain /stream/getSources now returns an encrypted shape
 * ({tracks, enc, server} — no `sources`). The player bundle rewrites
 * getSources→getSourcesNew in the browser, which is why embeds kept working
 * while this server resolver went dark. Always use getSourcesNew here.
 *
 * Only embeds on validated hosts (megaplay.buzz / vidtube.site) are accepted.
 */

const BASE = "https://anikoto.cz";
// Link-rotation resilient: any https host coming from the anikoto catalog
 // ajax is accepted (their server-list is the source of truth). Base URL and
 // getSources are discovered dynamically from the live embed page, so if the
 // embed domain changes tomorrow we keep matching automatically.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type AkServer = {
  name: string;
  type: "sub" | "hsub" | "dub";
  embedUrl: string;
  hls: string | null;
  vtt: { label: string; url: string }[];
  intro: { start: number; end: number } | null;
  outro: { start: number; end: number } | null;
};

export type AkResult = {
  ok: boolean;
  slug: string | null;
  internalId: string | null;
  episodeId: string | null;
  servers: AkServer[];
};

async function get(url: string, referer = BASE + "/", xhr = false): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: referer,
        ...(xhr ? { "X-Requested-With": "XMLHttpRequest" } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(14_000),
      redirect: "follow",
    });
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function similarity(candidate: string, wanted: string): number {
  const c = norm(candidate);
  const w = norm(wanted);
  if (!c || !w) return 0;
  if (c === w) return 100;
  if (c.startsWith(w) || w.startsWith(c)) return 80;
  if (c.includes(w) || w.includes(c)) return 60;
  return 0;
}

/** Step 1: text search, returns ranked candidates (title matching may be slug-only). */
async function searchTitles(
  query: string,
): Promise<{ watchUrl: string; score: number; episodes: number }[]> {
  const res = await get(`${BASE}/filter?keyword=${encodeURIComponent(query)}`);
  if (!res || !res.ok) return [];
  const html = await res.text().catch(() => "");
  if (!html) return [];

  const seen = new Set<string>();
  const hits: { url: string; title: string; episodes: number }[] = [];
  const re = /href="((?:https:\/\/anikoto\.cz)?\/watch\/[a-z0-9-]+)(?:\/ep-\d+)?"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 30) {
    const url = m[1].startsWith("http") ? m[1] : `${BASE}${m[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const nextItem = html.indexOf('class="item ', re.lastIndex);
    const ctx = html.slice(m.index, nextItem > m.index ? nextItem : m.index + 3000);
    const t =
      /data-jp="([^"<>]{2,120})"/.exec(ctx)?.[1] ??
      /title="([^"]{2,90})"/.exec(ctx)?.[1] ??
      /alt="([^"]{2,90})"/.exec(ctx)?.[1] ??
      /<h\d[^>]*>([^<>]{2,90})<\/h\d>/.exec(ctx)?.[1] ??
      "";
    const episodes = Number(/ep-status\s+sub[^>]*>\s*<span>\s*(\d+)/i.exec(ctx)?.[1] ?? 0);
    hits.push({ url, title: t, episodes });
  }

  return hits
    .map((h) => {
      const slugScore = similarity(h.url.split("/watch/")[1], query);
      const titleScore = h.title ? similarity(h.title, query) : 0;
      return { watchUrl: h.url, score: Math.max(titleScore, slugScore * 0.9), episodes: h.episodes };
    })
    .sort((a, b) => b.score - a.score || b.episodes - a.episodes)
    .filter((c) => c.score >= 40);
}

/** Step 2: watch page → internal anime id. */
async function internalIdFor(watchUrl: string): Promise<{ internalId: string; slug: string } | null> {
  const res = await get(`${watchUrl}/ep-1`, watchUrl);
  if (!res || !res.ok) return null;
  const html = await res.text().catch(() => "");
  const id = /(?:data-anime-id|data-id|show_id" value)="?(\d{3,9})/.exec(html)?.[1];
  const slug = /([a-z0-9-]+)$/.exec(watchUrl.split("/watch/")[1])?.[1] ?? null;
  return id && slug ? { internalId: id, slug } : null;
}

/** Step 3: episode list → token + episode id for requested ep number. */
async function episodeTokenFor(
  internalId: string,
  ep: number,
  referer: string,
): Promise<{ token: string; episodeId: string } | null> {
  const res = await get(`${BASE}/ajax/episode/list/${internalId}`, referer, true);
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as { result?: string } | null;
  const body = (json?.result ?? "").replace(/\\"/g, '"').replace(/\\\//g, "/");
  if (!body) return null;

  const itemRe =
    /<li[^>]*>\s*<a[^>]*data-id="(\d+)"[^>]*data-num="(\d+)"[^>]*data-ids="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(body))) {
    if (Number(m[2]) === ep) return { token: m[3], episodeId: m[1] };
  }
  return null;
}

/** Step 4: server list → per-type server tokens with names. */
async function serverTokens(
  episodeId: string,
  token: string,
  referer: string,
): Promise<{ name: string; type: AkServer["type"]; linkId: string }[]> {
  const res = await get(
    `${BASE}/ajax/server/list?servers=${encodeURIComponent(token)}`,
    referer,
    true,
  );
  if (!res || !res.ok) return [];
  const json = (await res.json().catch(() => null)) as { result?: string } | null;
  const body = (json?.result ?? "").replace(/\\"/g, '"').replace(/\\\//g, "/");
  if (!body) return [];

  const out: { name: string; type: AkServer["type"]; linkId: string }[] = [];
  const typeBlocks = body.split(/<div class="type" data-type="/);
  for (const block of typeBlocks) {
    const type = block.match(/^([a-z]+)"/)?.[1];
    if (type !== "sub" && type !== "hsub" && type !== "dub") continue;
    const liRe = /<li[^>]*data-link-id="([^"]+)"[^>]*>([^<]{1,30})<\/li>/g;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(block))) {
      out.push({ name: m[2].trim(), type, linkId: m[1] });
    }
  }
  return out;
}

/**
 * Any-embed → live HLS + VTT. Shared by the anikoto chain AND the ani.pm
 * (19-server) resolver — embed page is fetched, base_url + data-id discovered,
 * then {base_url}/stream/getSourcesNew is called. Host-agnostic by design.
 */
export async function sourcesFromEmbed(
  embedUrl: string,
  referer = `${BASE}/`,
): Promise<{ hls: string | null; vtt: { label: string; url: string }[] } | null> {
  if (/^javascript:/i.test(embedUrl) || !/^https:\/\//.test(embedUrl)) return null;
  let host = "";
  try {
    host = new URL(embedUrl).hostname;
  } catch {
    return null;
  }
  if (!host || host.includes("localhost")) return null;

  const page = await get(embedUrl, referer);
  if (!page || !page.ok) return null;
  const pageHtml = await page.text().catch(() => "");
  const baseUrl = /base_url:\s*'([^']+)'/.exec(pageHtml)?.[1] ?? `https://${host}/`;
  const dataId = /data-id="(\d+)"/.exec(pageHtml)?.[1];
  if (!dataId) return null;

  let hls: string | null = null;
  let vtt: { label: string; url: string }[] = [];
  // getSourcesNew = legacy plain shape ({sources:{file}, tracks}). Plain
  // getSources returns {tracks, enc} with no direct file — never use it here.
  const srcRes = await get(
    `${baseUrl.replace(/\/$/, "")}/stream/getSourcesNew?id=${dataId}&type=sub`,
    embedUrl.trim(),
    true,
  );
  if (srcRes && srcRes.ok) {
    const srcJson = (await srcRes.json().catch(() => null)) as {
      sources?: { file?: string } | { file?: string }[];
      tracks?: { file?: string; label?: string; kind?: string }[];
    } | null;
    const file = Array.isArray(srcJson?.sources)
      ? srcJson?.sources[0]?.file
      : (srcJson?.sources as { file?: string } | undefined)?.file;
    if (typeof file === "string" && file.includes("m3u8")) hls = file.replace(/\\/g, "");
    const tracks = Array.isArray(srcJson?.tracks) ? srcJson!.tracks : [];
    vtt = tracks
      .filter((t) => (t.kind === "captions" || t.kind === "subtitles" || !t.kind) && typeof t.file === "string")
      .map((t) => ({ label: t.label || "English", url: (t.file ?? "").replace(/\\/g, "") }));
  }

  return { hls, vtt };
}

/** A playlist is playable when the CDN answers with m3u8 content. */
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

/** Step 5+6: token → embed → getSources → direct HLS + VTT. */
async function resolveToken(
  link: { name: string; type: AkServer["type"]; linkId: string },
  referer: string,
): Promise<AkServer | null> {
  const res = await get(`${BASE}/ajax/server?get=${encodeURIComponent(link.linkId)}`, referer, true);
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as {
    result?: { url?: string; skip_data?: { intro?: number[]; outro?: number[] } };
  } | null;
  const embedUrl = json?.result?.url?.replace(/\\/g, "");
  if (!embedUrl) return null;
  let host = "";
  try {
    host = new URL(embedUrl).hostname;
  } catch {
    return null;
  }
  if (!host || host.includes("localhost")) return null;

  const toArray = (a?: number[]): { start: number; end: number } | null =>
    a && a.length >= 2 ? { start: a[0], end: a[1] } : null;

  // Fetch embed page → base_url + data-id
  const page = await get(embedUrl, BASE + "/");
  if (!page || !page.ok) return null;
  const pageHtml = await page.text().catch(() => "");
  const baseUrl = /base_url:\s*'([^']+)'/.exec(pageHtml)?.[1] ?? `https://${host}/`;
  const dataId = /data-id="(\d+)"/.exec(pageHtml)?.[1];
  if (!dataId) return null;

  // getSources → HLS + VTT (getSourcesNew keeps the plain {sources,tracks}
  // shape; plain getSources is encrypted now — see note at top of file).
  let hls: string | null = null;
  let vtt: { label: string; url: string }[] = [];
  const srcRes = await get(
    `${baseUrl.replace(/\/$/, "")}/stream/getSourcesNew?id=${dataId}&type=${link.type === "dub" ? "dub" : "sub"}`,
    embedUrl,
    true,
  );
  if (srcRes && srcRes.ok) {
    const srcJson = (await srcRes.json().catch(() => null)) as {
      sources?: { file?: string } | { file?: string }[];
      tracks?: { file?: string; label?: string; kind?: string; default?: boolean }[];
    } | null;
    const file = Array.isArray(srcJson?.sources)
      ? srcJson?.sources[0]?.file
      : (srcJson?.sources as { file?: string } | undefined)?.file;
    if (typeof file === "string" && file.includes("m3u8")) hls = file.replace(/\\/g, "");
    const tracks = Array.isArray(srcJson?.tracks) ? srcJson!.tracks : [];
    vtt = tracks
      .filter((t) => (t.kind === "captions" || t.kind === "subtitles" || !t.kind) && typeof t.file === "string")
      .map((t) => ({ label: t.label || "English", url: (t.file ?? "").replace(/\\/g, "") }));
  }

  // Reject expired/rotated playlist URLs so dead HD-1/HD-2 pills never show.
  if (hls && !(await isPlayable(hls, referer))) hls = null;

  return {
    name: link.name,
    type: link.type,
    embedUrl,
    hls,
    vtt,
    intro: toArray(json?.result?.skip_data?.intro ?? undefined),
    outro: toArray(json?.result?.skip_data?.outro ?? undefined),
  };
}

/* Cache */
const g = globalThis as unknown as { __na_ak?: TtlCache<AkResult> };
const cache: TtlCache<AkResult> = (g.__na_ak ??= new TtlCache<AkResult>(120));

export async function resolveAnikoto(params: {
  romaji: string;
  english?: string | null;
  synonyms?: string[] | null;
  ep: number;
}): Promise<AkResult> {
  const { romaji, english, synonyms, ep } = params;
  const titles = [...new Set([romaji, english ?? "", ...(synonyms ?? [])].filter(Boolean))];
  const key = `v2:${titles.join("|")}|${ep}`;
  const empty: AkResult = { ok: false, slug: null, internalId: null, episodeId: null, servers: [] };
  const hit = cache.get(key);
  if (hit) return hit;

  // AniKoto slugs often contain a provider-specific suffix (for example
  // "one-piece-odmau"). Search every AniList title alias and merge by URL so
  // a catalog name does not have to match the AniList display title exactly.
  const searched = await Promise.all(titles.map((title) => searchTitles(title)));
  const byUrl = new Map<string, { watchUrl: string; score: number; episodes: number }>();
  for (const list of searched) {
    for (const candidate of list) {
      const previous = byUrl.get(candidate.watchUrl);
      if (!previous || candidate.score > previous.score) byUrl.set(candidate.watchUrl, candidate);
    }
  }
  const candidates = [...byUrl.values()].sort((a, b) => b.score - a.score);
  if (!candidates.length) {
    cache.set(key, empty, 5 * 60_000);
    return empty;
  }

  // Walk candidates until one actually HAS the requested episode — this
  // prevents special/movie pages hijacking main-series episodes.
  let ids: { internalId: string; slug: string } | null = null;
  let epTok: { token: string; episodeId: string } | null = null;
  let watchPageUrl = "";

  // Walk MANY candidates until one actually HAS the requested episode — this
  // prevents special/movie pages hijacking main-series episodes. Candidates
  // are similarity-sorted, so exact title matches win first.
  for (const cand of candidates.slice(0, 10)) {
    const tryIds = await internalIdFor(cand.watchUrl);
    if (!tryIds) continue;
    const pageUrl = `${cand.watchUrl}/ep-${ep}`;
    const tryTok = await episodeTokenFor(tryIds.internalId, ep, pageUrl);
    if (tryTok) {
      // When the episode exists, prefer exact-name matches; keep going for
      // a better name match if this one is only a weak partial hit.
      ids = tryIds;
      epTok = tryTok;
      watchPageUrl = pageUrl;
      const slugText = cand.watchUrl.split("/watch/")[1] ?? "";
      const strong = Math.max(...titles.map((title) => similarity(slugText, title)));
      if (strong >= 70) break;
    }
  }
  if (!ids || !epTok) {
    cache.set(key, empty, 5 * 60_000);
    return { ...empty, slug: ids?.slug ?? null, internalId: ids?.internalId ?? null };
  }

  const tokens = await serverTokens(epTok.episodeId, epTok.token, watchPageUrl);
  // Resolve all server tokens in parallel.
  const resolved = await Promise.all(tokens.map((t) => resolveToken(t, watchPageUrl)));
  const servers = resolved.filter((s): s is AkServer => Boolean(s));

  const result: AkResult = {
    ok: servers.length > 0,
    slug: ids.slug,
    internalId: ids.internalId,
    episodeId: epTok.episodeId,
    servers,
  };
  cache.set(key, result, (result.ok ? 25 * 60_000 : 5 * 60_000));
  return result;
}
