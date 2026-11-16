/**
 * GET /api/stream/sources?animeId=<anilist>&ep=<n>
 *
 * Provider order:
 *   1. Anikoto catalog chain (correct per-episode mapping, named servers,
 *      direct HLS + VTT via embed getSourcesNew) — primary.
 *   2. Shiro (direct multi-quality HLS/MP4 + English VTT) + AniKai (HD-2 Vibe/StreamHG)
 *      + AniChan (aggregated CDN-proxied HLS + VTT) — ID/title based,
 *      translate-ready, run in parallel.
 *   3. AniKuro aggregated waves — fallback for uncovered titles.
 *   4. "embed" — MegaPlay iframe only.
 */

import { getMediaDetail } from "@/lib/anilist";
import { resolveShiro } from "@/lib/stream/shiro";
import { resolveAnichan } from "@/lib/stream/anichan";
import { resolveAnikai } from "@/lib/stream/anikai";
import { resolveAnikoto, type AkServer } from "@/lib/stream/anikoto";
import { animeKaiServers } from "@/lib/stream/animekai";
import { resolveAnikage } from "@/lib/stream/anikage";
import { resolveAnipm } from "@/lib/stream/anipm";
import { resolveShonen } from "@/lib/stream/shonen";
import { resolveAnimeVillage } from "@/lib/stream/animevillage";
import { resolveJustAnime } from "@/lib/stream/justanime";
import { resolveAnimo } from "@/lib/stream/animo";
import { resolveHiAnime } from "@/lib/stream/hianime";
import { resolveAniZone, type AzServer } from "@/lib/stream/anizone";
import { resolveGuts, type GutsServer } from "@/lib/stream/guts";
import { resolveKuroko, type KuServer } from "@/lib/stream/kuroko";
import { resolveEmbedPuppeteer, type EmbedServer } from "@/lib/stream/embed-puppeteer";
import { resolveStreams } from "@/lib/stream/resolver";

export const dynamic = "force-dynamic";

/**
 * Dedupe is scoped PER SIDE: a DUB server may legitimately share a name with a
 * SUB server (different tabs), but within one tab each name/stream must appear
 * exactly once. Labels are normalised so scraped whitespace/case differences
 * can't sneak duplicates through.
 */
function dedupeServers(
  list: {
    id: string;
    label: string;
    url: string | null;
    embedUrl?: string;
    subtitles?: { label: string; url: string }[];
  }[],
) {
  // Aggregators reuse upstream names ("HD-1", "vidstream", …), so the same pill
  // can arrive from several layers. A DIRECT HLS entry always beats an
  // embed-only one with the same name, since it also enables captions,
  // quality switching and download.
  const ranked = list
    .map((srv, i) => ({ srv, i }))
    .sort((a, b) => {
      const dir = (s: { url: string | null }) => (s.url ? 0 : 1);
      const d = dir(a.srv) - dir(b.srv);
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.srv);

  const seenNames = new Set<string>();
  const seenUrls = new Set<string>();
  return ranked.filter((srv) => {
    const nameKey = srv.label.trim().toLowerCase().replace(/\s+/g, " ");
    const urlKey = (srv.url ?? srv.embedUrl ?? srv.id).trim();
    if (seenNames.has(nameKey) || seenUrls.has(urlKey)) return false;
    seenNames.add(nameKey);
    seenUrls.add(urlKey);
    return true;
  });
}

/** Remove duplicate VTT URLs and always put a real English track first. */
function dedupeSubtitleTracks(
  tracks: { label: string; url: string }[],
): { label: string; url: string }[] {
  const seen = new Set<string>();
  return tracks
    .filter((t) => Boolean(t.url) && !seen.has(t.url) && Boolean(seen.add(t.url)))
    .sort((a, b) => {
      const ae = /english|\beng\b/i.test(a.label) ? 0 : 1;
      const be = /english|\beng\b/i.test(b.label) ? 0 : 1;
      return ae - be;
    });
}


type Side = {
  servers: {
    id: string;
    label: string;
    url: string | null;
    embedUrl?: string;
    subtitles?: { label: string; url: string }[];
  }[];
  subtitles: { label: string; url: string }[];
} | null;

function akSide(servers: AkServer[], type: "sub" | "hsub" | "dub"): Side {
  const list = servers.filter((s) => s.type === type);
  if (!list.length) return null;
  return {
    servers: list.map((s, i) => ({
      id: `ak-${type}-${i}`,
      label: s.name,
      url: s.hls,
      embedUrl: s.embedUrl,
      subtitles: s.vtt,
    })),
    subtitles: list[0]?.vtt ?? [],
  };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const animeId = Number(sp.get("animeId") ?? "0");
  const ep = Math.max(1, Number(sp.get("ep") ?? "1") || 1);
  if (!animeId) return Response.json({ ok: false, error: "animeId required" }, { status: 400 });

  const fallbackRomaji = sp.get("romaji") || "";
  const fallbackEnglish = sp.get("english") || "";
  const fallbackSynonyms = sp.get("synonyms")
    ? sp.get("synonyms")!.split(",").filter(Boolean)
    : null;

  let romaji = "";
  let english: string | null = null;
  let synonyms: string[] | null = null;
  let malId: number | null = null;
  try {
    const detail = await getMediaDetail(animeId);
    romaji = detail?.title.romaji ?? fallbackRomaji;
    english = detail?.title.english ?? fallbackEnglish;
    synonyms = detail?.synonyms ?? fallbackSynonyms;
    malId = detail?.idMal ?? null;
  } catch {
    romaji = fallbackRomaji;
    english = fallbackEnglish;
    synonyms = fallbackSynonyms;
  }

  // AnimeKai-style ID-based embed servers (always available, no scraping).
  const kaiSub = animeKaiServers({ anilistId: animeId, malId, ep, lang: "sub" }).map((k) => ({
    id: k.id,
    label: k.label,
    url: null as string | null,
    embedUrl: k.embedUrl,
  }));
  const kaiDub = animeKaiServers({ anilistId: animeId, malId, ep, lang: "dub" }).map((k) => ({
    id: k.id,
    label: k.label,
    url: null as string | null,
    embedUrl: k.embedUrl,
  }));

    // AniZone — suzaku.xin-cdn.xyz direct HLS + VTT via episode page scrape.
    const azPromise = romaji
      ? resolveAniZone({ romaji, english, synonyms, ep }).catch(() => [])
      : Promise.resolve([]);
    // Kuroko.cc — index.php?page=api.stream&id=<anilist>&ep=<ep> (cookie-session + HLS + multi-sub)
    const kuPromise = animeId
      ? resolveKuroko({ anilistId: animeId, ep }).catch(() => [])
      : Promise.resolve([]);
    // Guts.to — title search → /ajax/v2/episode/servers + /ajax/v2/episode/sources (iframe embed + direct)
    const guPromise = romaji
      ? resolveGuts({ romaji, english, synonyms, ep }).catch(() => [])
      : Promise.resolve([]);
    // Flixani-style embed providers — Puppeteer loads embed pages and extracts
    // video sources from client-side JS (vidnest.fun, 4animo, tryembed, etc.)
    const epPromise = animeId
      ? resolveEmbedPuppeteer({
          embedUrls: [
            { url: `https://vidnest.fun/anime/${animeId}/${ep}/sub`, name: "VidPlay" },
            { url: `https://vidnest.fun/animepahe/${animeId}/${ep}/sub`, name: "VidStream" },
            { url: `https://cdn.4animo.xyz/embed/hd-1/ani/${animeId}/${ep}/sub`, name: "4Animo-1" },
            { url: `https://cdn.4animo.xyz/embed/hd-2/ani/${animeId}/${ep}/sub`, name: "4Animo-2" },
            { url: `https://tryembed.us.cc/embed/anime/${animeId}/${ep}/sub`, name: "TryEmbed" },
          ],
          type: "sub",
          ep,
        }).catch(() => null)
      : Promise.resolve(null);
    const epDubPromise = animeId
      ? resolveEmbedPuppeteer({
          embedUrls: [
            { url: `https://vidnest.fun/anime/${animeId}/${ep}/dub`, name: "VidPlay Dub" },
            { url: `https://vidnest.fun/animepahe/${animeId}/${ep}/dub`, name: "VidStream Dub" },
            { url: `https://cdn.4animo.xyz/embed/hd-1/ani/${animeId}/${ep}/dub`, name: "4Animo-1 Dub" },
            { url: `https://cdn.4animo.xyz/embed/hd-2/ani/${animeId}/${ep}/dub`, name: "4Animo-2 Dub" },
            { url: `https://tryembed.us.cc/embed/anime/${animeId}/${ep}/dub`, name: "TryEmbed Dub" },
          ],
          type: "dub",
          ep,
        }).catch(() => null)
      : Promise.resolve(null);

    try {
      // ---- Primary: Anikoto catalog chain (parallel with AniKage extra servers) ----
      const kagePromise = romaji
      ? resolveAnikage({ anilistId: animeId, romaji, english, ep }).catch(() => [])
      : Promise.resolve([]);
    const pmPromise = romaji
      ? resolveAnipm({ anilistId: animeId, romaji, english, ep }).catch(() => [])
      : Promise.resolve([]);
    // JustAnime needs only the AniList id — runs regardless of metadata.
    const jaPromise = resolveJustAnime(animeId, ep).catch(() => []);
    // AHSANIME also needs only the AniList id.
    const amPromise = resolveAnimo(animeId, ep).catch(() => []);
    // Shonen.to — id-only HLS + VTT (sub + dub), runs regardless of metadata.
    const shPromise = resolveShonen({ anilistId: animeId, ep }).catch(() => []);
    // animevillage.org — id-only HLS + VTT (sub + dub), runs regardless of metadata.
    const avPromise = resolveAnimeVillage({ anilistId: animeId, ep }).catch(() => []);
    // Shiro (direct multi-quality HLS/MP4 + English VTT) — id-only, single POST.
    const bdPromise = resolveShiro(animeId, ep).catch(() => []);
    // AniChan aggregates many hosts behind its own CDN proxy — id-only, one
    // session POST + three category GETs.
    const acPromise = resolveAnichan(animeId, ep).catch(() => []);
    const hiPromise = romaji
      ? resolveHiAnime({ romaji, english, synonyms, ep }).catch(() => [])
      : Promise.resolve([]);
    const kaiPromise = romaji
      ? resolveAnikai({ romaji, english, synonyms, ep }).catch(() => [])
      : Promise.resolve([]);

    // AniList metadata may be 403/429 blocked. These two resolvers need only
    // the numeric AniList id, so keep streaming + translation alive anyway.
    if (!romaji) {
      const [ja, am, sh, bd, ac, av] = await Promise.all([jaPromise, amPromise, shPromise, bdPromise, acPromise, avPromise]);
      // AniChan hands back ready-to-play CDN-proxied HLS, so it slots in
      // alongside Shiro without any per-host referer work.
      const mapAc = (acList: typeof ac, type: "sub" | "dub" | "hsub", prefix: string) =>
        acList
          .filter((c) => c.type === type)
          .map((c, i) => ({
            id: `${prefix}-${i}`,
            label: c.name,
            url: c.hls,
            embedUrl: c.hls ? undefined : c.embedUrl,
            subtitles: c.vtt,
          }));
      const acSub = mapAc(ac, "sub", "ac-sub");
      const acDub = mapAc(ac, "dub", "ac-dub");
      const acHsub = mapAc(ac, "hsub", "ac-hsub");
      const acVtt = ac.find((c) => c.vtt.length && c.type === "sub")?.vtt ?? [];
      const bdSub = bd
        .filter((b) => b.type === "sub" && b.hls)
        .map((b, i) => ({
          id: `shiro-sub-${i}`,
          label: b.name,
          url: b.hls as string,
          embedUrl: undefined,
          subtitles: b.vtt,
        }));
      const bdDub = bd
        .filter((b) => b.type === "dub" && b.hls)
        .map((b, i) => ({
          id: `shiro-dub-${i}`,
          label: b.name,
          url: b.hls as string,
          embedUrl: undefined,
          subtitles: b.vtt,
        }));
      const bdVtt = bd.find((b) => b.vtt.length && b.type === "sub")?.vtt ?? [];
      const idSub = [
        ...ja
          .filter((j) => j.type === "sub" && j.hls)
          .map((j, i) => ({
            id: `ja-sub-${i}`,
            label: j.name,
            url: j.hls as string,
            embedUrl: undefined,
            subtitles: j.vtt,
          })),
        ...am
          .filter((a) => a.type === "sub")
          .map((a, i) => ({
            id: `am-sub-${i}`,
            label: a.name,
            url: a.hls,
            embedUrl: undefined,
            subtitles: a.vtt,
          })),
        ...sh
          .filter((s) => s.type === "sub" && s.hls)
          .map((s, i) => ({
            id: `sh-sub-${i}`,
            label: s.name,
            url: s.hls as string,
            embedUrl: undefined,
            subtitles: s.vtt,
          })),
        ...av
          .filter((a) => a.type === "sub" && a.hls)
          .map((a, i) => ({
            id: `av-sub-${i}`,
            label: a.name,
            url: a.hls as string,
            embedUrl: undefined,
            subtitles: a.vtt,
          })),
      ];
      const idDub = [
        ...ja
          .filter((j) => j.type === "dub" && j.hls)
          .map((j, i) => ({
            id: `ja-dub-${i}`,
            label: j.name,
            url: j.hls as string,
            embedUrl: undefined,
            subtitles: j.vtt,
          })),
        ...am
          .filter((a) => a.type === "dub")
          .map((a, i) => ({
            id: `am-dub-${i}`,
            label: a.name,
            url: a.hls,
            embedUrl: undefined,
            subtitles: a.vtt,
          })),
        ...sh
          .filter((s) => s.type === "dub" && s.hls)
          .map((s, i) => ({
            id: `sh-dub-${i}`,
            label: s.name,
            url: s.hls as string,
            embedUrl: undefined,
            subtitles: s.vtt,
          })),
        ...av
          .filter((a) => a.type === "dub" && a.hls)
          .map((a, i) => ({
            id: `av-dub-${i}`,
            label: a.name,
            url: a.hls as string,
            embedUrl: undefined,
            subtitles: a.vtt,
          })),
      ];
      const idHsub = ja
        .filter((j) => j.type === "hsub" && j.hls)
        .map((j, i) => ({
          id: `ja-hsub-${i}`,
          label: j.name,
          url: j.hls as string,
          embedUrl: undefined,
        }));
      const idTracks = dedupeSubtitleTracks([
        ...bdVtt,
        ...ja.filter((j) => j.type === "sub").flatMap((j) => j.vtt),
        ...am.filter((a) => a.type === "sub").flatMap((a) => a.vtt),
        ...sh.filter((s) => s.type === "sub").flatMap((s) => s.vtt),
                ...av.filter((a) => a.type === "sub").flatMap((a) => a.vtt),
      ]);

      if (idSub.length || idDub.length || idHsub.length || bdSub.length || bdDub.length || acSub.length || acDub.length || acHsub.length) {
        return Response.json({
          ok: true,
          provider: bdSub.length ? "shiro" : ja.length ? "justanime" : "ahsanime",
          animeId,
          ep,
          sub: {
            servers: dedupeServers([...bdSub, ...acSub, ...idSub, ...kaiSub]),
            subtitles: dedupeSubtitleTracks([...acVtt, ...idTracks]),
          },
          hsub: dedupeServers([...idHsub, ...acHsub]).length
            ? { servers: dedupeServers([...idHsub, ...acHsub]), subtitles: [] }
            : null,
          dub: {
            servers: dedupeServers([...bdDub, ...acDub, ...idDub, ...kaiDub]),
            subtitles: dedupeSubtitleTracks([
              ...ac.filter((c) => c.type === "dub").flatMap((c) => c.vtt),
              ...bd.filter((b) => b.type === "dub").flatMap((b) => b.vtt),
              ...ja.filter((j) => j.type === "dub").flatMap((j) => j.vtt),
              ...am.filter((a) => a.type === "dub").flatMap((a) => a.vtt),
            ]),
          },
          embeds: { sub: null, hsub: null, dub: null },
        });
      }
    }

    if (romaji) {
    const [ak, kage, pm, ja, am, sh, hi, bd, ac, kai, av, az, ku, gu, embedSub, embedDub] = await Promise.all([
      resolveAnikoto({ romaji, english, synonyms, ep }),
      kagePromise,
      pmPromise,
      jaPromise,
      amPromise,
      shPromise,
      hiPromise,
      bdPromise,
      acPromise,
      kaiPromise,
      avPromise,
      azPromise,
      kuPromise,
      guPromise,
      epPromise,
      epDubPromise,
    ]);
      const amSub = am
        .filter((a) => a.type === "sub")
        .map((a, i) => ({
          id: `am-sub-${i}`,
          label: a.name,
          url: a.hls,
          embedUrl: a.hls ? undefined : a.embedUrl,
          subtitles: a.vtt,
        }));
      const amDub = am
        .filter((a) => a.type === "dub")
        .map((a, i) => ({
          id: `am-dub-${i}`,
          label: a.name,
          url: a.hls,
          embedUrl: a.hls ? undefined : a.embedUrl,
          subtitles: a.vtt,
        }));
      const hiSub = hi
        .filter((h) => h.type === "sub")
        .map((h, i) => ({
          id: `hi-sub-${i}`,
          label: h.name,
          url: h.hls,
          embedUrl: h.hls ? undefined : h.embedUrl,
          subtitles: h.vtt,
        }));
      const hiDub = hi
        .filter((h) => h.type === "dub")
        .map((h, i) => ({
          id: `hi-dub-${i}`,
          label: h.name,
          url: h.hls,
          embedUrl: h.hls ? undefined : h.embedUrl,
          subtitles: h.vtt,
        }));
      const azSub = az
        .filter((a) => a.type === "sub" && a.hls)
        .map((a, i) => ({
          id: `az-sub-${i}`,
          label: a.name,
          url: a.hls as string,
          embedUrl: undefined,
          subtitles: a.vtt,
          referer: a.referer,
        }));
      const kuSub = ku
        .filter((a) => a.type === "sub" && a.hls)
        .map((a, i) => ({
          id: `ku-sub-${i}`,
          label: a.name,
          url: a.hls as string,
          embedUrl: undefined,
          subtitles: a.vtt,
          referer: a.referer,
        }));
      const guSub = gu
        .filter((a) => (a.type === "sub" || a.type === "dub") && (a.hls || a.embedUrl))
        .map((a, i) => ({
          id: `gu-sub-${i}`,
          label: a.name,
          url: a.hls ?? null,
          embedUrl: a.embedUrl ?? undefined,
          subtitles: a.vtt,
          referer: a.referer,
        }));
      const embedSubSub = embedSub
        ? [{
            id: `embed-sub-0`,
            label: embedSub.name,
            url: embedSub.hls ?? null,
            embedUrl: embedSub.embedUrl ?? undefined,
            subtitles: embedSub.vtt,
            referer: embedSub.referer,
          }]
        : [];
      const embedDubSub = embedDub
        ? [{
            id: `embed-dub-0`,
            label: embedDub.name,
            url: embedDub.hls ?? null,
            embedUrl: embedDub.embedUrl ?? undefined,
            subtitles: embedDub.vtt,
            referer: embedDub.referer,
          }]
        : [];
      const amVtt = am.find((a) => a.vtt.length && a.type === "sub")?.vtt ?? null;
      const azVtt = az.find((a) => a.vtt.length && a.type === "sub")?.vtt ?? null;
      const kuVtt = ku.find((a) => a.vtt.length && a.type === "sub")?.vtt ?? null;
      const guVtt = gu.find((a) => a.vtt.length)?.vtt ?? null;
      const embedSubVtt = embedSub?.vtt.length ? embedSub.vtt : null;
      const embedDubVtt = embedDub?.vtt.length ? embedDub.vtt : null;
      const jaSub = ja
        .filter((j) => j.type === "sub" && j.hls)
        .map((j, i) => ({
          id: `ja-sub-${i}`,
          label: j.name,
          url: j.hls as string,
          embedUrl: undefined,
          subtitles: j.vtt,
        }));
      const jaHsub = ja
        .filter((j) => j.type === "hsub" && j.hls)
        .map((j, i) => ({ id: `ja-hsub-${i}`, label: j.name, url: j.hls as string, embedUrl: undefined }));
      const jaDub = ja
        .filter((j) => j.type === "dub" && j.hls)
        .map((j, i) => ({
          id: `ja-dub-${i}`,
          label: j.name,
          url: j.hls as string,
          embedUrl: undefined,
          subtitles: j.vtt,
        }));
      const jaVtt = ja.find((j) => j.vtt.length && j.type === "sub")?.vtt ?? null;
      const bdSub = bd
        .filter((b) => b.type === "sub" && b.hls)
        .map((b, i) => ({
          id: `shiro-sub-${i}`,
          label: b.name,
          url: b.hls as string,
          embedUrl: undefined,
          subtitles: b.vtt,
        }));
      const bdDub = bd
        .filter((b) => b.type === "dub" && b.hls)
        .map((b, i) => ({
          id: `shiro-dub-${i}`,
          label: b.name,
          url: b.hls as string,
          embedUrl: undefined,
          subtitles: b.vtt,
        }));
      const bdVtt = bd.find((b) => b.vtt.length && b.type === "sub")?.vtt ?? null;
      const bdDubVtt = bd.find((b) => b.vtt.length && b.type === "dub")?.vtt ?? null;
      // AniChan: ready-to-play CDN-proxied HLS + VTT, no per-host referer work.
      const mapAc = (type: "sub" | "dub" | "hsub", prefix: string) =>
        ac
          .filter((c) => c.type === type)
          .map((c, i) => ({
            id: `${prefix}-${i}`,
            label: c.name,
            url: c.hls,
            embedUrl: c.hls ? undefined : c.embedUrl,
            subtitles: c.vtt,
          }));
      const acSub = mapAc("sub", "ac-sub");
      const acHsub = mapAc("hsub", "ac-hsub");
      const acDub = mapAc("dub", "ac-dub");
      const acVtt = ac.find((c) => c.vtt.length && c.type === "sub")?.vtt ?? null;
      // AniKai (HD-2 Vibe / StreamHG direct HLS; sub-tab carries English VTT).
      // Named aik* to avoid colliding with AnimeKai's kaiSub/kaiDub above.
      const mapAik = (type: "sub" | "hsub" | "dub", prefix: string) =>
        kai
          .filter((k) => k.type === type && k.hls)
          .map((k, i) => ({
            id: `${prefix}-${i}`,
            label: k.name,
            url: k.hls as string,
            embedUrl: k.embedUrl,
            subtitles: k.vtt,
          }));
      const aikSub = mapAik("sub", "aik-sub");
      const aikHsub = mapAik("hsub", "aik-hsub").map(({ subtitles: _s, ...rest }) => rest);
      const aikDub = mapAik("dub", "aik-dub");
      const aikVtt = kai.find((k) => k.vtt.length && k.type === "sub")?.vtt ?? null;
      const aikDubVtt = kai.find((k) => k.vtt.length && k.type === "dub")?.vtt ?? null;
      const pmSub = pm
        .filter((p) => p.type === "sub" && p.hls)
        .map((p, i) => ({
          id: `pm-sub-${i}`,
          label: p.name,
          url: p.hls as string,
          embedUrl: p.embedUrl,
          subtitles: p.vtt,
        }));
      const pmHsub = pm
        .filter((p) => p.type === "hsub" && p.hls)
        .map((p, i) => ({ id: `pm-hsub-${i}`, label: p.name, url: p.hls as string, embedUrl: p.embedUrl }));
      const pmDub = pm
        .filter((p) => p.type === "dub" && p.hls)
        .map((p, i) => ({
          id: `pm-dub-${i}`,
          label: p.name,
          url: p.hls as string,
          embedUrl: p.embedUrl,
          subtitles: p.vtt,
        }));
      const pmVtt = pm.find((p) => p.vtt.length && p.type === "sub")?.vtt ?? null;
      const shSub = sh
        .filter((s) => s.type === "sub" && s.hls)
        .map((s, i) => ({
          id: `sh-sub-${i}`,
          label: s.name,
          url: s.hls as string,
          embedUrl: undefined,
          subtitles: s.vtt,
        }));
      const shDub = sh
        .filter((s) => s.type === "dub" && s.hls)
        .map((s, i) => ({
          id: `sh-dub-${i}`,
          label: s.name,
          url: s.hls as string,
          embedUrl: undefined,
          subtitles: s.vtt,
        }));
      const shVtt = sh.find((s) => s.vtt.length && s.type === "sub")?.vtt ?? null;
      const avSub = av
        .filter((a) => a.type === "sub" && a.hls)
        .map((a, i) => ({
          id: `av-sub-${i}`,
          label: a.name,
          url: a.hls as string,
          embedUrl: undefined,
          subtitles: a.vtt,
        }));
      const avDub = av
        .filter((a) => a.type === "dub" && a.hls)
        .map((a, i) => ({
          id: `av-dub-${i}`,
          label: a.name,
          url: a.hls as string,
          embedUrl: undefined,
          subtitles: a.vtt,
        }));
      const avVtt = av.find((a) => a.vtt.length && a.type === "sub")?.vtt ?? null;
      if (ak.ok || kage.length || pm.length || ja.length || am.length || hi.length || bd.length || ac.length || kai.length || sh.length || az.length || ku.length || gu.length || embedSub || embedDub) {
        const sub = akSide(ak.servers, "sub");
        const hsub = akSide(ak.servers, "hsub");
        const dub = akSide(ak.servers, "dub");
        const kageSub = kage
          .filter((k) => k.type === "sub")
          .map((k, i) => ({
            id: `kage-sub-${i}`,
            label: k.name,
            url: k.hls,
            embedUrl: undefined,
            subtitles: k.vtt,
          }));
        const kageHsub = kage
          .filter((k) => k.type === "hsub")
          .map((k, i) => ({ id: `kage-hsub-${i}`, label: k.name, url: k.hls, embedUrl: undefined }));
        const kageVtt = kage.find((k) => k.vtt.length)?.vtt ?? null;

        // Cross-layer dedup: pm and anikoto resolve the same underlying
        // streams (identical HLS URLs), and their names overlap too. Keep only
        // the first server per (name) and per (hls|embedUrl) across ALL layers.
        const dedupe = dedupeServers;

        const mergedSub = (() => {
          // Shiro direct servers sit right behind title-matched Anikoto:
          // correct per-episode mapping (AniList-id indexed) + translate-ready.
          const raw = sub
            ? [...sub.servers, ...bdSub, ...acSub, ...aikSub, ...kaiSub, ...kageSub, ...pmSub, ...jaSub, ...amSub, ...shSub, ...hiSub, ...avSub, ...azSub, ...kuSub, ...guSub, ...embedSubSub, ...embedDubSub]
            : [...bdSub, ...acSub, ...aikSub, ...kaiSub, ...kageSub, ...pmSub, ...jaSub, ...amSub, ...shSub, ...hiSub, ...avSub, ...azSub, ...kuSub, ...guSub, ...embedSubSub, ...embedDubSub];
          const servers = dedupe(raw);
          const side = {
            servers,
            subtitles: dedupeSubtitleTracks([
              ...(sub?.subtitles ?? []),
              ...(acVtt ?? []),
              ...(bdVtt ?? []),
              ...(aikVtt ?? []),
              ...(kageVtt ?? []),
              ...(pmVtt ?? []),
              ...(jaVtt ?? []),
              ...(amVtt ?? []),
              ...(azVtt ?? []),
              ...(kuVtt ?? []),
              ...(guVtt ?? []),
              ...(embedSubVtt ?? []),
              ...(embedDubVtt ?? []),
              ...(shVtt ?? []),
                            ...(avVtt ?? []),
            ]),
          };
          return side.servers.length ? side : null;
        })();
        const mergedHsub = (() => {
          const raw = hsub
            ? [...hsub.servers, ...acHsub, ...aikHsub, ...kageHsub, ...pmHsub, ...jaHsub]
            : [...acHsub, ...aikHsub, ...kageHsub, ...pmHsub, ...jaHsub];
          const servers = dedupe(raw);
          return servers.length ? { servers, subtitles: [] as { label: string; url: string }[] } : null;
        })();
        // DUB side now carries English VTTs too (anikoto/shiro/anikai dub
        // servers ship caption tracks) so the 🌐 translate badge + bar work
        // in DUB mode, not just SUB.
        const dubTracks = (list: { subtitles?: { label: string; url: string }[] }[]) =>
          list.flatMap((s) => s.subtitles ?? []);
        const mergedDub = (() => {
          const raw = dub
            ? [...dub.servers, ...bdDub, ...acDub, ...aikDub, ...pmDub, ...jaDub, ...amDub, ...shDub, ...hiDub, ...avDub]
            : [...bdDub, ...acDub, ...aikDub, ...pmDub, ...jaDub, ...amDub, ...shDub, ...hiDub, ...avDub];
          const servers = dedupe(raw);
          if (!servers.length) return null;
          return {
            servers,
            subtitles: dedupeSubtitleTracks([
              ...(dub?.subtitles ?? []),
              ...dubTracks(acDub),
              ...dubTracks(bdDub),
              ...dubTracks(aikDub),
              ...dubTracks(pmDub),
              ...dubTracks(jaDub),
              ...dubTracks(amDub),
              ...dubTracks(shDub),
                          ]),
          };
        })();

        return Response.json({
          ok: true,
          provider: ak.ok ? "anikoto" : bd.length ? "shiro" : ac.length ? "anichan" : kai.length ? "anikai" : hi.length ? "hianime" : ja.length ? "justanime" : pm.length ? "AniPM" : "anikage",
          animeId,
          ep,
          slug: ak.slug ?? null,
          sub: mergedSub,
          hsub: mergedHsub,
          dub: mergedDub,
          embeds: {
            sub: ak.servers.find((s) => s.type === "sub")?.embedUrl ?? null,
            hsub: ak.servers.find((s) => s.type === "hsub")?.embedUrl ?? null,
            dub: ak.servers.find((s) => s.type === "dub")?.embedUrl ?? null,
          },
        });
      }
    }

    // ---- Fallback: AniKuro waves ----
    const resolved = await resolveStreams(animeId, ep);
    if (resolved.ok) {
      return Response.json({
        ok: true,
        provider: resolved.sub?.provider ?? resolved.dub?.provider ?? "custom",
        animeId,
        ep,
        sub: {
          servers: dedupeServers([
            ...(resolved.sub?.servers ?? []).map((s) => ({
              id: s.id,
              label: s.label,
              url: s.url as string | null,
              embedUrl: undefined as string | undefined,
            })),
            ...kaiSub,
          ]),
          subtitles: resolved.sub?.subtitles ?? [],
        },
        hsub: null,
        dub: {
          servers: dedupeServers([
            ...(resolved.dub?.servers ?? []).map((s) => ({
              id: s.id,
              label: s.label,
              url: s.url as string | null,
              embedUrl: undefined as string | undefined,
            })),
            ...kaiDub,
          ]),
          subtitles: resolved.dub?.subtitles ?? [],
        },
        embeds: { sub: null, hsub: null, dub: null },
      });
    }
  } catch (e) {
    return Response.json({
      ok: true,
      provider: "embed",
      animeId,
      ep,
      sub: null,
      hsub: null,
      dub: null,
      embeds: { sub: null, hsub: null, dub: null },
      note: e instanceof Error ? e.message : "resolver error",
    });
  }

  return Response.json({
    ok: true,
    provider: "animekai",
    animeId,
    ep,
    sub: { servers: dedupeServers(kaiSub), subtitles: [] },
    hsub: null,
    dub: { servers: dedupeServers(kaiDub), subtitles: [] },
    embeds: { sub: null, hsub: null, dub: null },
  });
}
