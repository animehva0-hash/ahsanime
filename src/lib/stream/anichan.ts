/**
 * AniChan resolver (https://anichan.to).
 *
 * Aggregator that fronts many upstreams and hands back *ready-to-play* URLs
 * through its own CDN proxy, so no per-host referer juggling is needed here.
 *
 * Chain (verified live):
 *
 *   POST /api/watch/session   { token: "" }        → { ok, exp, mode }
 *       Sets a cookie the server API checks. No Turnstile needed as long as the
 *       anonymous token stays empty.
 *   GET  /api/watch/servers?anilistId=<id>&ep=<n>&category=sub|dub|hardsub
 *       → { servers: [{ name, label, host, type, rank, stream, subtitles[],
 *                       subLangs, subType }] }
 *
 *   type "hls"   → `stream` is a toroplay m3u8 proxy (multi-quality masters)
 *   type "embed" → iframe-only server, returned as embedUrl
 *   subtitles[]  → { lang, default, url } where url is a toroplay VTT proxy
 *
 * Most entries mirror upstreams we already resolve directly (anikoto / zoko /
 * megaplay HD-1/HD-2 / echovideo), but the aggregation adds senshi, kaa,
 * vidhawk and anihq, plus a guaranteed session. Servers are de-duplicated by
 * host so the player list stays short.
 */

import { TtlCache } from "@/lib/lru";

const ORIGIN = "https://anichan.to";
const SESSION_API = `${ORIGIN}/api/watch/session`;
const SERVERS_API = `${ORIGIN}/api/watch/servers`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export const ANICHAN_REFERER = `${ORIGIN}/`;

export type AnichanServer = {
  name: string;
  type: "sub" | "dub" | "hsub";
  hls: string | null;
  embedUrl?: string;
  vtt: { label: string; url: string }[];
  rank: number;
  referer: string;
};

type AnichanSubtitle = { lang?: string; default?: boolean; url?: string };
type AnichanServerEntry = {
  name?: string;
  label?: string;
  host?: string;
  type?: string;
  rank?: number;
  stream?: string;
  subtitles?: AnichanSubtitle[];
  subType?: string;
};
type AnichanResponse = { servers?: AnichanServerEntry[] };

const g = globalThis as unknown as { __na_anichan?: TtlCache<AnichanServer[]> };
const cache: TtlCache<AnichanServer[]> = (g.__na_anichan ??= new TtlCache<AnichanServer[]>(200));

/** Session cookies + expiry, refreshed in bulk before every lookup. */
type Session = { cookie: string; expires: number };
const session = g as unknown as { __na_anichan_sess?: Session };

async function getSession(): Promise<string | null> {
  const now = Date.now();
  const current = session.__na_anichan_sess;
  if (current && current.expires > now) return current.cookie;

  try {
    const res = await fetch(SESSION_API, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: ORIGIN,
        Referer: ANICHAN_REFERER,
      },
      body: JSON.stringify({ token: "" }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { exp?: number };
    const setCookie = res.headers.get("set-cookie") ?? "";
    const jar = setCookie
      .split(/,(?=\s*\S+=)/)
      .map((c) => c.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");
    if (!jar) return null;
    // Renew a minute before the advertised expiry.
    const expires = (Number(json?.exp ?? 0) || now / 1000 + 7200) * 1000 - 60_000;
    session.__na_anichan_sess = { cookie: jar, expires };
    return jar;
  } catch {
    return null;
  }
}

async function getServers(
  anilistId: number,
  ep: number,
  category: string,
  cookie: string,
): Promise<AnichanServerEntry[]> {
  const url =
    `${SERVERS_API}?anilistId=${anilistId}&ep=${ep}` +
    `&category=${category}&tier=${encodeURIComponent(ANICHAN_REFERER)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Cookie: cookie,
        Referer: ANICHAN_REFERER,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as AnichanResponse;
    return Array.isArray(json?.servers) ? json.servers : [];
  } catch {
    return [];
  }
}

/** Upstream label → the name users recognise. */
function labelFor(entry: AnichanServerEntry): string {
  const label = (entry.label ?? "").trim();
  const host = (entry.host ?? "").trim();
  if (label) return label;
  if (host) return host;
  return (entry.name ?? "AniChan").trim();
}

async function resolveCategory(
  anilistId: number,
  ep: number,
  type: "sub" | "dub" | "hsub",
  wireCategory: string,
  cookie: string,
): Promise<AnichanServer[]> {
  const entries = await getServers(anilistId, ep, wireCategory, cookie);
  const seen = new Set<string>();
  const out: AnichanServer[] = [];

  for (const entry of entries) {
    const host = (entry.host ?? entry.label ?? "").trim();
    // One pill per host: the same upstream appears in several rows.
    if (host && seen.has(host)) continue;

    const vtt: { label: string; url: string }[] = [];
    for (const t of entry.subtitles ?? []) {
      if (!t.url) continue;
      vtt.push({ label: t.lang || "English", url: t.url });
    }
    // English first so the translate bar picks it up automatically.
    vtt.sort((a, b) => (/eng/i.test(a.label) ? 0 : 1) - (/eng/i.test(b.label) ? 0 : 1));

    const isEmbed = entry.type === "embed" || !entry.stream;
    // AniChan wraps upstream playlists in its own CDN proxy
    // (…/api/watch/m3u8?url=…), so the URL never ends in .m3u8.
    if (!isEmbed && !/(\.m3u8|watch\/m3u8)/i.test(entry.stream ?? "")) continue;
    if (host) seen.add(host);

    out.push({
      name: labelFor(entry),
      type,
      hls: isEmbed ? null : (entry.stream as string),
      embedUrl: isEmbed ? (entry.stream ?? undefined) : undefined,
      vtt,
      rank: Number(entry.rank ?? 99),
      referer: ANICHAN_REFERER,
    });
  }

  return out.sort((a, b) => a.rank - b.rank);
}

export async function resolveAnichan(anilistId: number, ep: number): Promise<AnichanServer[]> {
  const key = `anichan:${anilistId}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: AnichanServer[], ok: boolean) => {
    cache.set(key, data, ok ? 20 * 60_000 : 4 * 60_000);
    return data;
  };

  const cookie = await getSession();
  if (!cookie) return done([], false);

  const [subs, dubs, hardsubs] = await Promise.all([
    resolveCategory(anilistId, ep, "sub", "sub", cookie),
    resolveCategory(anilistId, ep, "dub", "dub", cookie),
    // AniChan spells this category "hardsub" on the wire; internally the
    // player calls it "hsub" to match the other resolvers.
    resolveCategory(anilistId, ep, "hsub", "hardsub", cookie),
  ]);

  const all = [...subs, ...dubs, ...hardsubs];
  return done(all, all.length > 0);
}
