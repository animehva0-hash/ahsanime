/**
 * Media proxy for HLS playback.
 *
 * GET /api/stream/proxy?url=<encoded>
 * - .m3u8 → fetched with the correct Referer, rewritten so every URI
 *   (variants, audio/subtitle playlists, keys, segments) routes back here.
 * - segments/keys → streamed with correct content-type; providers mislabeling
 *   MPEG-TS chunks as image/jpeg are detected via the 0x47 TS sync byte and
 *   corrected to video/mp2t.
 */

import { clientIp, rateLimit } from "@/lib/rate-limit";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const REFERER_POLICIES: [RegExp, string][] = [
  [/hls2\.aniwatchtv\.uk/i, "https://zokoanime.video/"],
  // Vidwish/AnimeGG progressive MP4 redirects to vidcache.net and requires the
  // original AnimeGG referer through the redirect chain.
  [/animegg\.org|vidcache\.net/i, "https://www.animegg.org/"],
  [/akage\.lol/i, "https://anikage.cc/"],
  [/watching\.onl/i, "https://megaplay.buzz/"],
  [/kryntal\.top|megap\./i, "https://megaplay.buzz/"],
  [/akirax\.buzz|shiora\.top|mikora\.top|vidtub/i, "https://vidtube.site/"],
  // Shiro serves its own media on shiro.so; no special referer needed, but be
  // explicit so a rotated Origin header is sent instead of the MegaPlay default.
  [/shiro\.so/i, "https://shiro.so/"],
  // AniChan hands back CDN-proxied URLs; its own CDN still wants a
  // matching Origin/Referer or it rejects the playlist.
  [/anichan\.to|toroplay\.cymru/i, "https://anichan.to/"],
  // AniKai: VibePlayer workers + StreamHG CDNs + Anizara subtitles.
  [/vibevibe\.workers\.dev|bibiemb\.xyz/i, "https://bibiemb.xyz/"],
  [/cdn-centaurus\.com|retailservices\.shop|otakuhg\.site/i, "https://otakuhg.site/"],
  [/anizara\.store/i, "https://www3.anikai.cc/"],
  [/echovideo|burntburst/i, "https://play2.echovideo.ru/"],
  // MegaPlay CDN hosts used by Anikoto/4Animo HLS playlists and segments.
  [/nexabloom\.top|imgnex\.top|ncdn\./i, "https://megaplay.buzz/"],
  // Shonen.to HLS stream (referer = shonen.to).
  [/shonen\.to|stream\.shonen\.to/i, "https://shonen.to/"],
  // AniKito embed/CDN hosts.
  [/anikoto\.cz|anikoto\.cat/i, "https://anikoto.cz/"],
  // AHSANIME (cdn.4animo.xyz) HLS + subtitle tracks.
  [/4animo\.xyz/i, "https://indanime.co/"],
  // HiAnime ZokoAnime embed/CDN hosts.
  [/zokoanime\.(xyz|com|fun|live|net|io)/i, "https://hianime.at/"],
  // ZokoAnime HLS + VTT (served from dramahot.top, referer = zokoanime.video).
  [/dramahot\.top/i, "https://zokoanime.video/"],
];

/** Segment CDNs rotate hostnames, so default to the MegaPlay referer. */
const DEFAULT_REFERER = "https://megaplay.buzz/";

/** Workers.dev proxy hosts used by resolvers to bypass CDN blocks. */
const PROXY_HOST_PATTERNS = [/streamed-\d+\.workers\.dev/i, /\.workers\.dev\/proxy/i];

function isProxyUrl(url: URL): boolean {
  return PROXY_HOST_PATTERNS.some((p) => p.test(url.host));
}

/**
 * When the requested URL is a workers.dev proxy (e.g.
 * divine-block-4f3d.streamed-4.workers.dev/proxy?url=<target>&headers=<json>),
 * extract the inner target URL and its headers so we can fetch it directly
 * with the correct referer instead of relying on the (often broken) proxy.
 */
function extractProxyTarget(url: URL): { target: URL; headers: Record<string, string> } | null {
  if (!isProxyUrl(url)) return null;
  const inner = new URL(url.toString()).searchParams.get("url");
  if (!inner) return null;
  try {
    const decoded = decodeURIComponent(inner);
    const target = new URL(decoded);
    const headers: Record<string, string> = {};
    const h = target.searchParams.get("headers");
    if (h) {
      try {
        const parsed = JSON.parse(decodeURIComponent(h));
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === "string") headers[k] = v;
          }
        }
      } catch {
        /* ignore malformed headers */
      }
    }
    // Strip the headers param from the target URL so it isn't sent to the origin.
    target.searchParams.delete("headers");
    return { target, headers };
  } catch {
    return null;
  }
}

function refererFor(host: string): string | null {
  for (const [re, ref] of REFERER_POLICIES) if (re.test(host)) return ref;
  return DEFAULT_REFERER;
}

function assertSafeUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" ||
    host.startsWith("192.168.") || host.startsWith("10.") || host.endsWith(".internal")
  ) throw new Error("host not allowed");
  return url;
}

function proxied(path: string, absolute: string, ref: string): string {
  return `${path}?url=${encodeURIComponent(absolute)}&ref=${encodeURIComponent(ref)}`;
}

const PROXY_PATH = "/api/stream/proxy";

/**
 * Segments frequently live on rotating CDN hosts (e.g. *.sugevideo.xyz) that
 * still require the ORIGINAL player's Referer/Origin. The playlist request
 * therefore stamps its referer into every rewritten child URL.
 */
async function fetchUpstream(
  url: URL,
  refOverride?: string | null,
  range?: string | null,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const ref = refOverride || refererFor(url.host) || DEFAULT_REFERER;
  let origin = "";
  try {
    origin = new URL(ref).origin;
  } catch {
    origin = "";
  }
  // Never let forwarded headers override our explicitly-set Referer/Origin.
  const cleanHeaders = { ...(extraHeaders ?? {}) };
  delete cleanHeaders["referer"];
  delete cleanHeaders["Referer"];
  return fetch(url.toString(), {
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      Referer: ref,
      ...(origin ? { Origin: origin } : {}),
      ...(range ? { Range: range } : {}),
      ...cleanHeaders,
    },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
}

export const dynamic = "force-dynamic";

function rateLimitedResponse(resetInMs: number) {
  return new Response(JSON.stringify({ ok: false, error: "rate limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(Math.ceil(resetInMs / 1000)),
    },
  });
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const raw = sp.get("url") ?? "";
  const rl = rateLimit(`px:${clientIp(req)}`, 240, 60_000);
  if (!rl.ok) {
    return rateLimitedResponse(rl.resetInMs);
  }
  const inheritedRef = sp.get("ref");
  const rawResolved = raw.startsWith("/")
    ? `${new URL(inheritedRef || DEFAULT_REFERER).origin}${raw}`
    : raw;
  try {
    const url = assertSafeUrl(rawResolved);

    // If this is a workers.dev proxy URL, fetch the inner target directly with
    // the correct referer instead of relying on the (often 502-ing) proxy.
    const proxyTarget = extractProxyTarget(url);
    const fetchUrl = proxyTarget?.target ?? url;
    const refererHost = proxyTarget ? proxyTarget.target.host : url.host;
    const effectiveRef = inheritedRef || refererFor(refererHost) || DEFAULT_REFERER;

    // Forward any headers the resolver embedded (e.g. user-agent + referer).
    const forwardedHeaders: Record<string, string> = { ...proxyTarget?.headers };
    const requestedRange = req.headers.get("range");
    const upstream = await fetchUpstream(fetchUrl, effectiveRef, requestedRange, forwardedHeaders);
    if (!upstream.ok) {
      return Response.json({ ok: false, error: `upstream ${upstream.status}` }, { status: 502 });
    }

    const ctype = (upstream.headers.get("content-type") ?? "").toLowerCase();
    const looksPlaylist = ctype.includes("mpegurl") || /\.m3u8($|\?)/i.test(url.pathname + url.search);

    if (looksPlaylist) {
      const text = await upstream.text();
      const base = url;
      const rewritten = text
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) {
            // Rewrite URI= attributes inside tags (keys, media playlists, subtitles).
            if (trimmed.startsWith("#") && trimmed.includes("URI=")) {
              return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
                try {
                  return `URI="${proxied(PROXY_PATH, new URL(uri, base).toString(), effectiveRef)}"`;
                } catch {
                  return _m;
                }
              });
            }
            return line;
          }
          try {
            return proxied(PROXY_PATH, new URL(trimmed, base).toString(), effectiveRef);
          } catch {
            return line;
          }
        })
        .join("\n");
      return new Response(rewritten, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }

    // Progressive MP4: stream the upstream body directly and preserve its
    // Range/206 headers. Buffering it would delay playback and exhaust memory.
    const looksMp4 =
      ctype.includes("video/mp4") || /\.mp4($|\?)/i.test(url.pathname + url.search);
    if (looksMp4) {
      const headers = new Headers({
        "Content-Type": "video/mp4",
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": upstream.headers.get("accept-ranges") ?? "bytes",
        "Cache-Control": "public, max-age=300",
      });
      const contentLength = upstream.headers.get("content-length");
      const contentRange = upstream.headers.get("content-range");
      if (contentLength) headers.set("Content-Length", contentLength);
      if (contentRange) headers.set("Content-Range", contentRange);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    const buf = await upstream.arrayBuffer();
    // MPEG-TS sync-byte detection (0x47 every 188 bytes).
    const view = new Uint8Array(buf);
    const isTs =
      view.length > 376 &&
      view[0] === 0x47 &&
      view[188] === 0x47 &&
      view[376] === 0x47;
    const contentType = isTs
      ? "video/mp2t"
      : ctype.includes("image/") && /\.(ts|m2ts)($|\?)/i.test(url.pathname)
        ? "video/mp2t"
        : ctype || "application/octet-stream";

    return new Response(buf, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "proxy error" },
      { status: 400 },
    );
  }
}
