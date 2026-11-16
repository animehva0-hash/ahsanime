import { resolveShiro } from "@/lib/stream/shiro";

export const dynamic = "force-dynamic";

const ORIGIN = "https://cdn.4animo.xyz";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * Fast ID-only source bootstrap.
 *
 * The full resolver extracts direct HLS/VTT and can take several seconds on a
 * cold provider cache. These deterministic AHSANIME embed routes need only the
 * AniList id and episode. We validate the embed page contains `sourcesUrl`,
 * then return the server pills immediately as embed fallbacks. The client
 * replaces them with direct HLS + English VTT as soon as the full resolver is
 * ready, without reloading the page.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const animeId = Number(sp.get("animeId") ?? "0");
  const ep = Math.max(1, Number(sp.get("ep") ?? "1") || 1);

  if (!Number.isInteger(animeId) || animeId <= 0) {
    return Response.json({ ok: false, error: "animeId required" }, { status: 400 });
  }

  type Candidate = {
    id: string;
    label: string;
    type: "sub" | "dub";
    url: null;
    embedUrl: string;
  };

  const candidates: Candidate[] = [
    {
      id: "am-fast-sub-1",
      label: "AHSANIME ReHD",
      type: "sub",
      url: null,
      embedUrl: `${ORIGIN}/embed/hd-1/ani/${animeId}/${ep}/sub`,
    },
    {
      id: "am-fast-sub-2",
      label: "AHSANIME HD-2",
      type: "sub",
      url: null,
      embedUrl: `${ORIGIN}/embed/hd-2/ani/${animeId}/${ep}/sub`,
    },
    {
      id: "am-fast-sub-3",
      label: "AHSANIME HD-4",
      type: "sub",
      url: null,
      embedUrl: `${ORIGIN}/embed/hd-4/ani/${animeId}/${ep}/sub`,
    },
    {
      id: "am-fast-dub-1",
      label: "AHSANIME ReHD Dub",
      type: "dub",
      url: null,
      embedUrl: `${ORIGIN}/embed/hd-1/ani/${animeId}/${ep}/dub`,
    },
    {
      id: "am-fast-dub-2",
      label: "AHSANIME HD-2 Dub",
      type: "dub",
      url: null,
      embedUrl: `${ORIGIN}/embed/hd-2/ani/${animeId}/${ep}/dub`,
    },
    {
      id: "am-fast-dub-3",
      label: "AHSANIME HD-4 Dub",
      type: "dub",
      url: null,
      embedUrl: `${ORIGIN}/embed/hd-4/ani/${animeId}/${ep}/dub`,
    },
  ];

  // Validate all three embeds in parallel. If the provider is unreachable from
  // the current host (e.g. Vercel egress restrictions), still return every
  // candidate as an embed fallback rather than showing no servers at all —
  // the browser can often reach the CDN directly even when the server cannot.
  // AniBD is gone; Shiro (direct multi-quality HLS + English VTT) replaces it and
  // resolves in a single POST: when it hits, the player gets a DIRECT playable
  // server + translatable subtitles immediately instead of waiting for the full
  // resolver.
  const [checked, shiro] = await Promise.all([
    Promise.all(
      candidates.map(async (c) => {
        try {
          const res = await fetch(c.embedUrl, {
            headers: { "User-Agent": UA, Referer: "https://indanime.co/" },
            cache: "no-store",
            signal: AbortSignal.timeout(4_000),
          });
          if (!res.ok) return c;
          const html = await res.text();
          return /sourcesUrl\s*=\s*'[^']+'/.test(html) ? c : null;
        } catch {
          // Network/timeout — assume it may work from the browser.
          return c;
        }
      }),
    ),
    resolveShiro(animeId, ep).catch(() => []),
  ]);

  const valid = checked.filter((c): c is Candidate => Boolean(c));
  // Fall back to all candidates if validation was inconclusive.
  const finalList = valid.length ? valid : candidates;
  const shiroServers = (type: "sub" | "dub") =>
    shiro
      .filter((b) => b.type === type && b.hls)
      .map((b, i) => ({
        id: `shiro-fast-${type}-${i}`,
        label: b.name,
        url: b.hls as string,
        embedUrl: undefined as string | undefined,
        subtitles: b.vtt,
      }));
  const shiroVtt = shiro.find((b) => b.vtt.length && b.type === "sub")?.vtt ?? [];
  const side = (type: "sub" | "dub") => {
    const servers = [
      ...shiroServers(type),
      ...finalList
        .filter((c) => c.type === type)
        .map(({ type: _type, ...server }) => server),
    ];
    const subtitles = type === "sub" ? shiroVtt : [];
    return servers.length ? { servers, subtitles } : null;
  };

  return Response.json({
    ok: true,
    provider: shiro.length ? "shiro-fast" : "ahsanime-fast",
    animeId,
    ep,
    sub: side("sub"),
    hsub: null,
    dub: side("dub"),
    embeds: { sub: null, hsub: null, dub: null },
  });
}
