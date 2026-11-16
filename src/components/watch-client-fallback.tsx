"use client";

/**
 * Watch-page fallback — server couldn't get AniList detail (quota over) →
 * fetch it from the visitor's browser (own IP/quota) and render the same
 * Player + episode rail instead of a 404.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clapperboard, Loader2 } from "lucide-react";
import { browserGetDetail, type MediaDetail } from "@/lib/anilist-client";
import { episodeTotal } from "@/lib/anime-constants";
import { formatLabel } from "@/lib/utils";
import Player from "@/components/player";
import EpisodeGrid from "@/components/episode-grid";
import AnimeImage from "@/components/anime-image";
import TitleText from "@/components/title-text";

export default function WatchClientFallback({
  animeId,
  episode,
}: {
  animeId: number;
  episode: number;
}) {
  const [media, setMedia] = useState<MediaDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    browserGetDetail(animeId)
      .then((m) => {
        if (!cancelled) (m ? setMedia(m) : setFailed(true));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [animeId]);

  if (failed) {
    return (
        <div className="shell flex min-h-[60dvh] flex-col items-center justify-center py-6 text-center">
          <p className="text-sm text-zinc-500">
            Episode abhi load nahi ho paya — server se bhi try kiya, tumhare
            connection se bhi. Thodi der me retry karo.
          </p>
          <Link
            href={`/anime/${animeId}`}
            className="mt-6 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-zinc-200"
          >
            Back to details
          </Link>
        </div>
      );
    }

    if (!media) {
      return (
        <div className="shell flex min-h-[60dvh] items-center justify-center py-6">
          <Loader2 className="h-7 w-7 animate-spin text-[#ff8a00]" />
        </div>
      );
    }

    const total = episodeTotal(media);
    const isMovie = media.format === "MOVIE";
    if ((total > 0 && episode > total) || (isMovie && episode !== 1)) {
      return (
        <div className="shell flex min-h-[60dvh] flex-col items-center justify-center py-6 text-center">
          <p className="text-sm text-zinc-500">Ye episode available nahi hai.</p>
        <Link
          href={`/anime/${media.id}`}
          className="mt-6 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-zinc-200"
        >
          Back to details
        </Link>
      </div>
    );
  }

  const color = media.coverImage?.color ?? "#ff8a00";
  const cover = media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;

  return (
    <div className="shell animate-fade-in py-6">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Link
          href={`/anime/${media.id}`}
          className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-zinc-300 transition-all hover:border-[#ff8a00]/50 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back
        </Link>
        <div className="min-w-0">
          <TitleText
            romaji={media.title.romaji}
            english={media.title.english}
            as="h1"
            className="font-display truncate text-lg font-bold tracking-tight text-white sm:text-xl"
          />
          <p className="mt-0.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">
            <Clapperboard className="h-3 w-3" />
            {formatLabel(media.format)} • {isMovie ? "Movie" : `Episode ${episode}`}
            {total > 0 && !isMovie ? ` of ${total}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]">
        <Player
          key={`${animeId}-${episode}`}
          anilistId={media.id}
          malId={media.idMal}
          episode={episode}
          epTotal={total}
          color={color}
          titleRomaji={media.title.romaji}
          titleEnglish={media.title.english}
          cover={cover}
        />

        <aside className="min-w-0">
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="mb-4 flex items-center gap-3">
              <AnimeImage
                sources={[cover, media.bannerImage]}
                alt={media.title.english ?? media.title.romaji ?? ""}
                className="h-16 w-12 rounded-lg object-cover"
                style={{ boxShadow: `0 8px 24px -8px ${color}66` }}
              />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffb86b]">
                  Now Playing
                </p>
                <p className="mt-1 text-sm font-bold text-white">
                  {isMovie ? "Movie" : `EP ${episode}`}
                </p>
              </div>
            </div>
            {total > 1 && (
              <EpisodeGrid animeId={media.id} total={total} current={episode} compact />
            )}
          </div>
        </aside>
      </div>
      <div className="h-10" />
    </div>
  );
}
