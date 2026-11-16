import { TtlCache } from "@/lib/lru";
/**
 * Fetch a remote subtitle (VTT/SRT/ASS) and normalize to VTT cues.
 * Cached in memory for 30 minutes to make repeated translations cheap.
 */

import { normalizeToVtt, parseVtt, type VttCue } from "./vtt";

const g = globalThis as unknown as {
  __na_subcache?: TtlCache<{ vtt: string; cues: VttCue[] }>;
};
// Hard cap: subtitle payloads are large (~80 KB each).
const subCache: TtlCache<{ vtt: string; cues: VttCue[] }> = (g.__na_subcache ??=
  new TtlCache<{ vtt: string; cues: VttCue[] }>(40));

const MAX_BYTES = 5 * 1024 * 1024;

export class SubtitleFetchError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SubtitleFetchError("Invalid subtitle URL", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SubtitleFetchError("Unsupported subtitle protocol", 400);
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.endsWith(".internal")
  ) {
    throw new SubtitleFetchError("Subtitle host is not allowed", 400);
  }
  return url;
}

/** Host-specific Referer policies (hotlink-protected CDNs). */
const REFERER_POLICIES: [RegExp, string][] = [
  [/akage\.lol/i, "https://anikage.cc/"],
  [/watching\.onl|kryntal\.top|megap\./i, "https://megaplay.buzz/"],
  [/akirax\.buzz|shiora\.top|mikora\.top|vidtub/i, "https://vidtube.site/"],
  [/shiro\.so/i, "https://shiro.so/"],
  // AniChan hands back CDN-proxied URLs; its own CDN still wants a
  // matching Origin/Referer or it rejects the playlist.
  [/anichan\.to|toroplay\.cymru/i, "https://anichan.to/"],
  [/anizara\.store/i, "https://www3.anikai.cc/"],
  [/echovideo\.ru|burntburst/i, "https://play2.echovideo.ru/"],
  // MegaPlay CDN hosts used by Anikoto/4Animo HLS + subtitle tracks.
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

function refererFor(host: string): string {
  for (const [re, ref] of REFERER_POLICIES) {
    if (re.test(host)) return ref;
  }
  return DEFAULT_REFERER;
}

export async function fetchSubtitleCues(rawUrl: string): Promise<{ vtt: string; cues: VttCue[] }> {
  const resolvedUrl = rawUrl.startsWith("/")
    ? `${new URL(DEFAULT_REFERER).origin}${rawUrl}`
    : rawUrl;
  const hit = subCache.get(resolvedUrl);
  if (hit) return { vtt: hit.vtt, cues: hit.cues };

  const url = assertSafeUrl(resolvedUrl);
  const referer = refererFor(url.host);
  let origin = "";
  try {
    origin = new URL(referer).origin;
  } catch {
    origin = "";
  }

  async function attempt(ref: string, orig: string): Promise<Response> {
    return fetch(url.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        Accept: "text/vtt, subtitle/srt, application/x-subrip, text/plain, */*",
        Referer: ref,
        ...(orig ? { Origin: orig } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
  }

  let res: Response;
  try {
    res = await attempt(referer, origin);
    if (!res.ok && res.status === 403) {
      res = await attempt(DEFAULT_REFERER, new URL(DEFAULT_REFERER).origin);
      if (!res.ok && res.status === 403) {
        res = await attempt("", "");
      }
    }
  } catch (e) {
    throw new SubtitleFetchError(
      `Could not reach subtitle host: ${e instanceof Error ? e.message : "network error"}`,
    );
  }

  if (!res.ok) throw new SubtitleFetchError(`Subtitle source responded ${res.status}`, 502);

  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new SubtitleFetchError("Empty subtitle file", 422);
  if (buf.byteLength > MAX_BYTES) throw new SubtitleFetchError("Subtitle file too large", 413);

  const text = new TextDecoder("utf-8").decode(buf);
  const vtt = normalizeToVtt(text);
  const cues = parseVtt(vtt);
  if (cues.length === 0) throw new SubtitleFetchError("No subtitle cues found", 422);

  subCache.set(resolvedUrl, { vtt, cues }, 30 * 60_000);
  return { vtt, cues };
}
