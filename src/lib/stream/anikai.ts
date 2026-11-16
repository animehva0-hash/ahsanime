/**
 * AniKai resolver (https://www3.anikai.cc).
 *
 * Watch pages embed the full server list as static HTML — no AJAX chain:
 *
 *   GET /browser?keyword={title}            → /watch/{slug} links
 *   GET /watch/{slug}/ep-{n}
 *     → <span class="tab tab_N" data-id="hsub|sub|dub">      (tab_0=hsub, tab_1=sub)
 *     → <span data-video="{embed}" data-tab="tab_N">Name</span>
 *       sub-tab embeds carry ?sub= / ?caption_1= / ?c1_file= English VTTs
 *       (cdn.anizara.store, translate-ready via the Gemini pipeline)
 *
 * Host verdicts (live-tested, per-site rule "error aaye to add mat karna"):
 *   ✅ bibiemb.xyz  (VibePlayer, "HD-2") — static master.m3u8 + subtitle vars
 *   ✅ otakuhg.site (StreamHG)           — Dean-Edwards-packed JWPlayer setup,
 *                                          unpacked server-side → master.m3u8
 *   ❌ otakuvid.online (Earnvids)        — CDN 403 under every referer → SKIP
 *   ❌ playmogo.com    (Doodstream)      — 80-byte JS challenge → SKIP
 */

import { TtlCache } from "@/lib/lru";

const BASE = "https://www3.anikai.cc";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type KaiServer = {
  name: string;
  type: "sub" | "hsub" | "dub";
  embedUrl: string;
  hls: string | null;
  vtt: { label: string; url: string }[];
  referer: string;
};

async function get(url: string, referer = `${BASE}/`): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: { "User-Agent": UA, Referer: referer, Accept: "text/html,*/*" },
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

/** /browser?keyword= → ranked watch slugs. */
async function searchSlugs(query: string): Promise<{ slug: string; score: number }[]> {
  const res = await get(`${BASE}/browser?keyword=${encodeURIComponent(query)}`);
  if (!res || !res.ok) return [];
  const html = await res.text().catch(() => "");
  if (!html) return [];
  const seen = new Set<string>();
  const out: { slug: string; score: number }[] = [];
  const re = /\/watch\/([a-z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 20) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const score = similarity(m[1], query);
    if (score >= 40) out.push({ slug: m[1], score });
  }
  return out.sort((a, b) => b.score - a.score);
}

type RawServer = { name: string; type: KaiServer["type"]; embedUrl: string; vtt: string | null };

/** Episode page → tab-typed server list. */
async function serversFor(slug: string, ep: number): Promise<RawServer[]> {
  const url = `${BASE}/watch/${slug}/ep-${ep}`;
  const res = await get(url);
  if (!res || !res.ok) return [];
  const html = await res.text().catch(() => "");
  if (!html) return [];

  const tabType = new Map<string, KaiServer["type"]>();
  const tabRe = /<span class="tab (tab_\d)" data-id="(hsub|sub|dub)">/g;
  let tm: RegExpExecArray | null;
  while ((tm = tabRe.exec(html))) tabType.set(tm[1], tm[2] as KaiServer["type"]);

  const out: RawServer[] = [];
  const re = /data-video="([^"]+)" data-tab='?(tab_\d)'?>\s*([^<]{1,24}?)\s*<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 16) {
    const type = tabType.get(m[2]);
    if (!type) continue;
    // Sub-tab embeds carry the English VTT as a query param (?sub= etc).
    let vtt: string | null = null;
    try {
      const u = new URL(m[1]);
      vtt =
        u.searchParams.get("sub") ??
        u.searchParams.get("caption_1") ??
        u.searchParams.get("c1_file");
      if (vtt && !/\.vtt(\?|$)/.test(vtt)) vtt = null;
    } catch {
      vtt = null;
    }
    out.push({ name: m[3].trim(), type, embedUrl: m[1], vtt });
  }
  return out;
}

/** Dean-Edwards packer unpack (StreamHG / Earnvids family). */
function unpackDeanEdwards(html: string): string | null {
  const m = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)\)\)/.exec(
    html.replace(/\n/g, ""),
  );
  if (!m) return null;
  let p = m[1];
  const a = Number(m[2]);
  const c = Number(m[3]);
  const k = m[4].split("|");
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  const base = (n: number): string => (n < a ? digits[n] : base(Math.floor(n / a)) + digits[n % a]);
  for (let i = c - 1; i >= 0; i--) {
    if (i < k.length && k[i]) p = p.replace(new RegExp(`\\b${base(i)}\\b`, "g"), k[i]);
  }
  return p;
}

/** VibePlayer (bibiemb.xyz): static master.m3u8 + subtitle vars. */
async function resolveVibe(
  embedUrl: string,
  vttHint: string | null,
): Promise<{ hls: string | null; vtt: { label: string; url: string }[] } | null> {
  const res = await get(embedUrl, `${BASE}/`);
  if (!res || !res.ok) return null;
  const html = await res.text().catch(() => "");
  const src = /const src = "([^"]+master\.m3u8[^"]*)"/.exec(html)?.[1] ?? null;
  if (!src) return null;
  const sub = /const subtitle = "([^"]*)"/.exec(html)?.[1] || vttHint;
  const vtt =
    sub && /\.vtt(\?|$)/.test(sub) ? [{ label: "English", url: sub }] : [];
  return { hls: src, vtt };
}

/** StreamHG (otakuhg.site): unpack → hls4||hls3||hls2 master.m3u8. */
async function resolveStreamHg(
  embedUrl: string,
  vttHint: string | null,
): Promise<{ hls: string | null; vtt: { label: string; url: string }[] } | null> {
  const res = await get(embedUrl, `${BASE}/`);
  if (!res || !res.ok) return null;
  const html = await res.text().catch(() => "");
  const unpacked = unpackDeanEdwards(html);
  if (!unpacked) return null;
  const links: Record<string, string> = {};
  const linkRe = /"(hls\d)"\s*:\s*"([^"]*m3u8[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(unpacked))) links[m[1]] = m[2];
  const hls = links.hls4 ?? links.hls3 ?? links.hls2 ?? null;
  if (!hls) return null;
  const vtt =
    vttHint && /\.vtt(\?|$)/.test(vttHint) ? [{ label: "English", url: vttHint }] : [];
  return { hls, vtt };
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

async function resolveOne(raw: RawServer): Promise<KaiServer | null> {
  let host = "";
  try {
    host = new URL(raw.embedUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  // Label must not collide with Anikoto's "HD-2" (route dedupes by name).
  const isVibe = host.includes("bibiemb.xyz");
  const isHg = host.includes("otakuhg.site");
  if (!isVibe && !isHg) return null; // Earnvids/Doodstream skipped (errors)

  const name = isVibe ? "HD-2 Vibe" : "StreamHG";
  const referer = isVibe ? "https://bibiemb.xyz/" : "https://otakuhg.site/";

  const found = isVibe
    ? await resolveVibe(raw.embedUrl, raw.vtt)
    : await resolveStreamHg(raw.embedUrl, raw.vtt);
  if (!found?.hls) return null;
  if (!(await isPlayable(found.hls, referer))) return null;

  return { name, type: raw.type, embedUrl: raw.embedUrl, hls: found.hls, vtt: found.vtt, referer };
}

const g = globalThis as unknown as { __na_kai?: TtlCache<KaiServer[]> };
const cache: TtlCache<KaiServer[]> = (g.__na_kai ??= new TtlCache<KaiServer[]>(120));

export async function resolveAnikai(params: {
  romaji: string;
  english?: string | null;
  synonyms?: string[] | null;
  ep: number;
}): Promise<KaiServer[]> {
  const { romaji, english, synonyms, ep } = params;
  const titles = [...new Set([romaji, english ?? "", ...(synonyms ?? [])].filter(Boolean))];
  const key = `kai:${titles.join("|")}|${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: KaiServer[], ok: boolean) => {
    cache.set(key, data, ok ? 25 * 60_000 : 5 * 60_000);
    return data;
  };

  const searched = await Promise.all(titles.map((t) => searchSlugs(t)));
  const bySlug = new Map<string, number>();
  for (const list of searched)
    for (const c of list) bySlug.set(c.slug, Math.max(bySlug.get(c.slug) ?? 0, c.score));
  const slugs = [...bySlug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!slugs.length) return done([], false);

  for (const [slug] of slugs) {
    const raws = await serversFor(slug, ep);
    if (!raws.length) continue;
    // Sub-with-VTT first (translate-ready), then hsub, then the rest.
    const ordered = [...raws].sort((a, b) => {
      const score = (r: RawServer) =>
        (r.type === "sub" && r.vtt ? 0 : r.type === "sub" ? 1 : r.type === "hsub" ? 2 : 3);
      return score(a) - score(b);
    });
    const resolved = await Promise.all(ordered.slice(0, 6).map(resolveOne));
    const servers = resolved.filter((s): s is KaiServer => Boolean(s));
    if (servers.length) return done(servers, true);
  }
  return done([], false);
}
