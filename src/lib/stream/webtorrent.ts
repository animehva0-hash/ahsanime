import { TtlCache } from "@/lib/lru";
/**
 * WebTorrent resolver — finds anime torrents on nyaa.media and animetosho.net,
 * returns magnet links with file listings. Works like zenshin's WebTorrent
 * streaming: a separate Express + WebTorrent server seeds the torrent and serves
 * video via HTTP Range requests, so the browser plays it like a normal MP4/HLS
 * stream.
 *
 * Chain (nyaa.media):
 *   GET https://nyaa.media/?q={anime title}+episode+{ep}&f=0&c=1_2&s=seeders&o=desc
 *     → scrape magnet links (infoHash from btih, name from dn param)
 *   → WebTorrent server seeds + serves /streamfile/:magnet/:filename
 *
 * Chain (animetosho.net fallback):
 *   GET https://animetosho.net/animes?search={title}
 *     → find /view/{id} links
 *   GET https://animetosho.net/view/{id}
 *     → scrape magnet link + subtitle files
 */

const NYAA_BASE = "https://nyaa.media";
const ANIMETOSHO_BASE = "https://animetosho.net";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export const WEBTORRENT_SERVER_URL =
  process.env.WEBTORRENT_SERVER_URL || "http://localhost:64622";

export type WebTorrentServer = {
  name: string;
  type: "sub" | "hsub" | "dub";
  hls: string | null; // null for webtorrent — uses streamUrl instead
  vtt: { label: string; url: string }[];
  embedUrl: string;
  streamUrl: string | null; // http://webtorrent-server/streamfile/:magnet/:filename
  magnet: string | null;
  filename: string | null;
  infoHash: string | null;
};

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Extract magnet links from nyaa.media HTML. The magnet's `dn` param contains
 * the URL-encoded torrent name, and `xt=urn:btih:` contains the info hash.
 */
function extractNyaaMagnets(html: string): Array<{
  magnet: string;
  name: string;
  infoHash: string;
  seeders: number;
}> {
  const results: Array<{ magnet: string; name: string; infoHash: string; seeders: number }> = [];
  const magnetRegex = /magnet:\?xt=urn:btih:([a-zA-Z0-9]{40})([^"'<>\s]*)/g;
  let match: RegExpExecArray | null;

  while ((match = magnetRegex.exec(html)) !== null) {
    const infoHash = match[1];
    const rest = match[2];

    // nyaa.media HTML-escapes & as &amp; in magnet URLs. Unescape so the
    // full magnet (with dn= name and trackers) is preserved.
    const unescapedRest = rest.replace(/&amp;/g, "&");
    const magnet = `magnet:?xt=urn:btih:${infoHash}${unescapedRest}`;

    // Decode the dn= parameter for the torrent name
    const dnMatch = unescapedRest.match(/[?&]dn=([^&]+)/);
    let name = "Unknown";
    if (dnMatch) {
      try {
        name = decodeURIComponent(dnMatch[1]);
      } catch {
        name = "Unknown";
      }
    }

    // Find seeders in surrounding context
    const start = Math.max(0, match.index - 300);
    const context = html.slice(start, match.index + 300);
    const seederMatch = context.match(/(\d+)\s*<\/td>\s*<td[^>]*class="[^"]*text-center[^"]*"[^>]*>\s*<a[^>]*href="magnet/);
    const seeders = seederMatch ? parseInt(seederMatch[1], 10) || 0 : 0;

    results.push({ magnet, name, infoHash, seeders });
  }

  return results;
}

/**
 * Extract magnet links from animetosho.net /view/{id} pages.
 */
function extractAnimetoshoMagnet(html: string): Array<{
  magnet: string;
  name: string;
  infoHash: string;
}> {
  const results: Array<{ magnet: string; name: string; infoHash: string }> = [];
  const magnetRegex = /magnet:\?xt=urn:btih:([a-zA-Z0-9]{40})([^"'<>\s]*)/g;
  let match: RegExpExecArray | null;

  while ((match = magnetRegex.exec(html)) !== null) {
    const infoHash = match[1];
    const rest = match[2];

    // Unescape HTML entities (&amp; → &) so the full magnet is preserved.
    const unescapedRest = rest.replace(/&amp;/g, "&");
    const magnet = `magnet:?xt=urn:btih:${infoHash}${unescapedRest}`;

    const dnMatch = unescapedRest.match(/[?&]dn=([^&]+)/);
    let name = "Unknown";
    if (dnMatch) {
      try {
        name = decodeURIComponent(dnMatch[1]);
      } catch {
        name = "Unknown";
      }
    }

    results.push({ magnet, name, infoHash });
  }

  return results;
}

/**
 * Find /view/{id} links on animetosho.net search results page.
 */
function findAnimetoshoViewLinks(html: string): string[] {
  const links: string[] = [];
  const viewRegex = /href="(\/view\/\d+)"/g;
  let match: RegExpExecArray | null;
  while ((match = viewRegex.exec(html)) !== null) {
    links.push(match[1]);
  }
  return links;
}

function serverFromMagnet(
  m: { magnet: string; name: string; infoHash: string; seeders?: number },
  type: WebTorrentServer["type"],
): WebTorrentServer {
  const streamUrl = `${WEBTORRENT_SERVER_URL}/streamfile/${encodeURIComponent(m.magnet)}/${encodeURIComponent(m.name)}`;
  return {
    name: `WebTorrent${m.seeders !== undefined ? ` (${m.seeders} SD)` : ""}`,
    type,
    hls: null,
    vtt: [],
    embedUrl: "",
    streamUrl,
    magnet: m.magnet,
    filename: m.name,
    infoHash: m.infoHash,
  };
}

const g = globalThis as unknown as { __na_webtorrent?: TtlCache<WebTorrentServer[]> };
const cache: TtlCache<WebTorrentServer[]> = (g.__na_webtorrent ??= new TtlCache<WebTorrentServer[]>(60));

export async function resolveWebTorrent(params: {
  anilistId: number;
  romaji?: string | null;
  english?: string | null;
  ep: number;
}): Promise<WebTorrentServer[]> {
  const { anilistId, ep, romaji, english } = params;
  const key = `webtorrent:${anilistId}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: WebTorrentServer[], ok: boolean) => {
    cache.set(key, data, (ok ? 30 * 60_000 : 5 * 60_000));
    return data;
  };

  const title = english || romaji || `anime-${anilistId}`;
  const servers: WebTorrentServer[] = [];

  // --- Primary: nyaa.media search ---
  const query = encodeURIComponent(`${title} episode ${ep}`);
  const nyaaHtml = await fetchHtml(
    `${NYAA_BASE}/?q=${query}&f=0&c=1_2&s=seeders&o=desc`,
  );

  if (nyaaHtml) {
    const magnets = extractNyaaMagnets(nyaaHtml);
    for (const m of magnets.slice(0, 3)) {
      const lower = m.name.toLowerCase();
      let type: WebTorrentServer["type"] = "sub";
      if (lower.includes("dub") || lower.includes("english dub")) type = "dub";
      else if (lower.includes("hardsub") || lower.includes("hard-sub")) type = "hsub";
      servers.push(serverFromMagnet(m, type));
    }
  }

  // --- Fallback: animetosho.net ---
  if (servers.length === 0) {
    const searchHtml = await fetchHtml(
      `${ANIMETOSHO_BASE}/animes?search=${encodeURIComponent(title)}`,
    );
    if (searchHtml) {
      const viewLinks = findAnimetoshoViewLinks(searchHtml);
      // Check up to 3 view pages for magnets
      for (const viewLink of viewLinks.slice(0, 3)) {
        const viewHtml = await fetchHtml(`${ANIMETOSHO_BASE}${viewLink}`);
        if (viewHtml) {
          const magnets = extractAnimetoshoMagnet(viewHtml);
          for (const m of magnets.slice(0, 2)) {
            const lower = m.name.toLowerCase();
            let type: WebTorrentServer["type"] = "sub";
            if (lower.includes("dub") || lower.includes("english dub")) type = "dub";
            else if (lower.includes("hardsub") || lower.includes("hard-sub")) type = "hsub";
            servers.push(serverFromMagnet(m, type));
          }
          if (servers.length >= 3) break;
        }
      }
    }
  }

  return done(servers, servers.length > 0);
}
