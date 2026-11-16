/**
 * AnimeKai-compatible embed servers.
 *
 * The AnimeKai watch page builds every server URL directly from the AniList /
 * MAL id, so these can be constructed without scraping:
 *
 *   ANI    → https://megavid.buzz/mal/{malId}/{ep}/{lang}
 *   ANI 2  → https://megavid.buzz/aniwave/al/{anilistId}/{ep}/{lang}
 *   HD-3   → https://megaplay.buzz/stream/mal/{malId}/{ep}/{lang}
 *   HD-4   → https://vidnest.fun/anime/{anilistId}/{ep}/{lang}
 *   HD-5   → https://tryembed.us.cc/embed/anime/{anilistId}/{ep}/{lang}
 *
 * (The blogger "FAST" server and the megaplay.su "HD-2" server use
 * per-episode encrypted ids, so they are intentionally not synthesised.)
 */

export type KaiLang = "sub" | "dub";

export type KaiServer = { id: string; label: string; embedUrl: string };

export function animeKaiServers(args: {
  anilistId: number;
  malId: number | null;
  ep: number;
  lang: KaiLang;
}): KaiServer[] {
  const { anilistId, malId, ep, lang } = args;
  const out: KaiServer[] = [];

  // ANI (mal megavid) and HD-4 (vidnest) intentionally omitted — they were
  // unreliable and carry no soft-sub/translation support.
  out.push({
    id: `kai-ani2-${lang}`,
    label: "ANI 2",
    embedUrl: `https://megavid.buzz/aniwave/al/${anilistId}/${ep}/${lang}`,
  });
  if (malId) {
    out.push({
      id: `kai-hd3-${lang}`,
      label: "HD-3",
      embedUrl: `https://megaplay.buzz/stream/mal/${malId}/${ep}/${lang}`,
    });
  }
  out.push({
    id: `kai-hd5-${lang}`,
    label: "HD-5",
    embedUrl: `https://tryembed.us.cc/embed/anime/${anilistId}/${ep}/${lang}`,
  });

  return out;
}
