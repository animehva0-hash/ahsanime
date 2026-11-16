/**
 * Server-side HLS download endpoint.
 *
 * GET /api/stream/download?url=<encoded-m3u8>&ref=<referer>&title=<name>&quality=<height>
 *
 * Fetches an HLS master/media playlist, resolves the requested quality variant,
 * downloads all segments (including init segment) and streams a merged file.
 */

import { clientIp, rateLimit } from "@/lib/rate-limit";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const REFERER_POLICIES: [RegExp, string][] = [
  [/hls2\.aniwatchtv\.uk/i, "https://zokoanime.video/"],
  [/animegg\.org|vidcache\.net/i, "https://www.animegg.org/"],
  [/akage\.lol/i, "https://anikage.cc/"],
  [/watching\.onl/i, "https://megaplay.buzz/"],
  [/kryntal\.top|megap\./i, "https://megaplay.buzz/"],
  [/akirax\.buzz|shiora\.top|mikora\.top|vidtub/i, "https://vidtube.site/"],
  [/shiro\.so/i, "https://shiro.so/"],
  [/anichan\.to|toroplay\.cymru/i, "https://anichan.to/"],
  [/vibevibe\.workers\.dev|bibiemb\.xyz/i, "https://bibiemb.xyz/"],
  [/cdn-centaurus\.com|retailservices\.shop|otakuhg\.site/i, "https://otakuhg.site/"],
  [/anizara\.store/i, "https://www3.anikai.cc/"],
  [/echovideo|burntburst/i, "https://play2.echovideo.ru/"],
  [/nexabloom\.top|imgnex\.top|ncdn\./i, "https://megaplay.buzz/"],
  [/megaplay\.buzz/i, "https://megaplay.buzz/"],
  [/shonen\.to|stream\.shonen\.to/i, "https://shonen.to/"],
  [/anikoto\.cz|anikoto\.cat/i, "https://anikoto.cz/"],
  [/4animo\.xyz/i, "https://indanime.co/"],
  [/zokoanime\.(xyz|com|fun|live|net|io)/i, "https://hianime.at/"],
  [/dramahot\.top/i, "https://zokoanime.video/"],
  [/aniwatchtv\.uk/i, "https://zokoanime.video/"],
];

const DEFAULT_REFERER = "https://megaplay.buzz/";
const PROXY_HOST_PATTERNS = [/streamed-\d+\.workers\.dev/i, /\.workers\.dev\/proxy/i];

function isProxyUrl(url: URL): boolean {
  return PROXY_HOST_PATTERNS.some((p) => p.test(url.host));
}

function extractProxyTarget(url: URL): { target: URL; headers: Record<string, string> } | null {
  if (!isProxyUrl(url)) return null;
  const inner = url.searchParams.get("url");
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
      } catch {}
    }
    target.searchParams.delete("headers");
    return { target, headers };
  } catch {
    return null;
  }
}

function refererFor(host: string): string {
  for (const [re, ref] of REFERER_POLICIES) if (re.test(host)) return ref;
  return DEFAULT_REFERER;
}

function originFor(ref: string): string {
  try {
    return new URL(ref).origin;
  } catch {
    return "";
  }
}

function assertSafeUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.startsWith("172.16.") ||
    host.startsWith("172.17.") ||
    host.startsWith("172.18.") ||
    host.startsWith("172.19.") ||
    host.startsWith("172.2") ||
    host.startsWith("172.30.") ||
    host.startsWith("172.31.") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("host not allowed");
  }
  return url;
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Segment {
  url: string;
}

function cleanForwardedHeaders(extra: Record<string, string> | undefined): Record<string, string> {
  const out = { ...(extra ?? {}) };
  for (const k of Object.keys(out)) {
    const lk = k.toLowerCase();
    if (lk === "referer" || lk === "origin" || lk === "host" || lk === "content-length") {
      delete out[k];
    }
  }
  return out;
}

function buildHeaders(ref: string, extra?: Record<string, string>, accept = "*/*"): HeadersInit {
  const origin = originFor(ref);
  return {
    "User-Agent": UA,
    Accept: accept,
    Referer: ref,
    ...(origin ? { Origin: origin } : {}),
    ...cleanForwardedHeaders(extra),
  };
}

async function fetchText(url: URL, ref: string, extra?: Record<string, string>): Promise<string> {
  const res = await fetch(url.toString(), {
    headers: buildHeaders(ref, extra, "application/vnd.apple.mpegurl,application/x-mpegURL,*/*"),
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`playlist fetch failed: ${res.status}`);
  return res.text();
}

function pickVariant(playlist: string, baseUrl: string, targetQuality = 0): string | null {
  const lines = playlist.split(/\r?\n/);
  let bestUrl: string | null = null;
  let bestHeight = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
    const height = resMatch ? parseInt(resMatch[1], 10) : 0;
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith("#"))) j++;
    if (j >= lines.length) continue;
    const variantUrl = new URL(lines[j].trim(), baseUrl).toString();
    if (targetQuality > 0) {
      if (bestUrl === null || Math.abs(height - targetQuality) < Math.abs(bestHeight - targetQuality)) {
        bestHeight = height;
        bestUrl = variantUrl;
      }
    } else if (height >= bestHeight) {
      bestHeight = height;
      bestUrl = variantUrl;
    }
  }

  return bestUrl;
}

function parseSegments(playlist: string, baseUrl: string): Segment[] {
  const lines = playlist.split(/\r?\n/);
  const segments: Segment[] = [];
  let initUrl: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXT-X-MAP:")) {
      const uriMatch = line.match(/URI="([^"]+)"/i);
      if (uriMatch) {
        try {
          initUrl = new URL(uriMatch[1], baseUrl).toString();
        } catch {}
      }
      continue;
    }

    if (line.startsWith("#")) continue;

    try {
      segments.push({ url: new URL(line, baseUrl).toString() });
    } catch {}
  }

  if (initUrl) segments.unshift({ url: initUrl });
  return segments;
}

function extFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (p.endsWith(".m4s") || p.endsWith(".mp4") || p.endsWith(".m4v")) return "mp4";
    if (p.endsWith(".aac")) return "aac";
  } catch {}
  return "ts";
}

async function fetchSegment(
  url: string,
  ref: string,
  extra?: Record<string, string>,
  tries = 6,
): Promise<Uint8Array | null> {
  for (let t = 0; t < tries; t++) {
    try {
      const res = await fetch(url, {
        headers: buildHeaders(ref, extra),
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > 0) return buf;
      }
      // Retry on transient upstream/rate-limit/server errors; fail fast on hard denies.
      if (res.status === 401 || res.status === 403 || res.status === 404) return null;
    } catch {}
    if (t < tries - 1) await new Promise((r) => setTimeout(r, 500 * (t + 1)));
  }
  return null;
}

async function fetchSegmentWithFallback(
  segUrl: URL,
  preferredRef: string,
  baseRef: string,
  extra?: Record<string, string>,
): Promise<Uint8Array | null> {
  const refs = [preferredRef, baseRef, DEFAULT_REFERER].filter(
    (r, i, arr) => Boolean(r) && arr.indexOf(r) === i,
  );
  for (const ref of refs) {
    const data = await fetchSegment(segUrl.toString(), ref, extra);
    if (data) return data;
  }
  // Last attempt without forwarded extra headers in case a CDN rejects them.
  for (const ref of refs) {
    const data = await fetchSegment(segUrl.toString(), ref, undefined, 3);
    if (data) return data;
  }
  return null;
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const raw = sp.get("url") ?? "";
  const titleParam = sp.get("title") || "anime-episode";
  const rl = rateLimit(`dl:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) return new Response("rate limited", { status: 429 });

  let inputUrl: URL;
  try {
    inputUrl = assertSafeUrl(raw);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "bad url" }, { status: 400 });
  }

  const proxyTarget = extractProxyTarget(inputUrl);
  const fetchUrl = proxyTarget?.target ?? inputUrl;
  const baseRefHost = proxyTarget ? proxyTarget.target.host : inputUrl.host;
  const refOverride = sp.get("ref");
  const baseRef = refOverride || refererFor(baseRefHost) || DEFAULT_REFERER;
  const forwardedHeaders = cleanForwardedHeaders(proxyTarget?.headers);
  const targetQuality = Math.max(0, parseInt(sp.get("quality") || "0", 10) || 0);

  try {
    let playlistBase = fetchUrl.toString();
    let playlistText = await fetchText(fetchUrl, baseRef, forwardedHeaders);

    const variantUrl = pickVariant(playlistText, playlistBase, targetQuality);
    if (variantUrl) {
      const vUrl = assertSafeUrl(variantUrl);
      playlistText = await fetchText(vUrl, refererFor(vUrl.host) || baseRef, forwardedHeaders);
      playlistBase = vUrl.toString();
    }

    const segments = parseSegments(playlistText, playlistBase);
    if (segments.length === 0) {
      return Response.json({ ok: false, error: "no segments found" }, { status: 502 });
    }

    const isTsLike = /\.ts($|\?)/i.test(segments[0]?.url ?? "") || extFromUrl(segments[0]?.url ?? "") === "ts";
    const ext = isTsLike ? "ts" : "mp4";
    const safeTitle =
      titleParam.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "anime-episode";
    const filename = `${safeTitle}.${ext}`;
    const contentType = ext === "ts" ? "video/mp2t" : "video/mp4";

    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();

    (async () => {
      try {
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const segUrl = assertSafeUrl(seg.url);
          const segRef = refererFor(segUrl.host) || baseRef;
          let data: Uint8Array | null = null;

          for (let attempt = 0; attempt < 3 && !data; attempt++) {
            data = await fetchSegmentWithFallback(segUrl, segRef, baseRef, forwardedHeaders);
            if (!data && attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
          }

          if (!data || data.byteLength === 0) {
            throw new Error(`segment ${i + 1}/${segments.length} failed`);
          }
          await writer.write(data);
        }
        await writer.close();
      } catch (e) {
        try {
          await writer.abort(e);
        } catch {}
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "download error" }, { status: 500 });
  }
}
