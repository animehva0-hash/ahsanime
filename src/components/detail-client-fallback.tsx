"use client";

/**
 * Anime-detail fallback — server quota over / AniList unreachable from the
 * server → fetch the SAME detail query from the visitor's browser (their own
 * IP/quota) and render a full usable page instead of a 404.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Layers, Loader2, MonitorPlay, Play, Star } from "lucide-react";
import { browserGetDetail, type MediaDetail } from "@/lib/anilist-client";
import { episodeTotal, type MediaCard } from "@/lib/anime-constants";
import {
  cleanDescription,
  cn,
  formatLabel,
  scoreLabel,
  seasonLabel,
  statusLabel,
} from "@/lib/utils";
import TitleText from "@/components/title-text";
import Description from "@/components/description";
import EpisodeGrid from "@/components/episode-grid";
import AiringCountdown from "@/components/airing-countdown";
import AnimeImage from "@/components/anime-image";
import Row from "@/components/row";

export default function DetailClientFallback({ id }: { id: number }) {
  const [media, setMedia] = useState<MediaDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    browserGetDetail(id)
      .then((m) => {
        if (!cancelled) (m ? setMedia(m) : setFailed(true));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (failed || (media === null && failed)) {
    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <p className="text-sm text-zinc-500">
          Ye anime abhi load nahi ho paya — server se bhi try kiya, tumhare
          connection se bhi. Thodi der me wapas aao.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-6 py-3 text-sm font-bold text-white"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  if (!media) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#ff8a00]" />
      </div>
    );
  }

  const total = episodeTotal(media);
  const score = scoreLabel(media.averageScore);
  const color = media.coverImage?.color ?? "#ff8a00";
  const coverArt = media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;
  const watchHref =
    media.status === "NOT_YET_RELEASED" && total === 0 ? null : `/watch/${media.id}/1`;
  const recs =
    media.recommendations?.nodes
      .map((n) => n.mediaRecommendation)
      .filter((m): m is MediaCard => !!m) ?? [];

  return (
    <div className="animate-fade-in">
      <div className="relative h-[38svh] min-h-[220px] overflow-hidden sm:h-[320px] lg:h-[400px]">
        {coverArt ? (
          <>
            <AnimeImage
              sources={[coverArt, media.bannerImage]}
              alt=""
              eager
              className="h-full w-full scale-110 object-cover object-top blur-[2px] sm:blur-0"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#07070d] via-[#07070d]/55 to-[#07070d]/25" />
          </>
        ) : (
          <div
            className="h-full w-full"
            style={{ background: `linear-gradient(135deg, ${color}44, #0d0d18 60%)` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07070d] via-[#07070d]/40 to-transparent" />
      </div>

      <div className="shell">
        <div className="-mt-20 flex flex-col gap-5 sm:-mt-24 md:-mt-28 md:flex-row md:gap-8">
          <div className="shrink-0">
            <AnimeImage
              sources={[coverArt, media.bannerImage]}
              alt={media.title.english ?? media.title.romaji ?? ""}
              eager
              className="w-40 rounded-2xl border border-white/15 object-cover shadow-2xl sm:w-52 md:w-56"
            />
          </div>

          <div className="min-w-0 flex-1 md:pt-28">
            {media.title.native && (
              <p className="mb-1 text-xs tracking-[0.25em] text-zinc-500">{media.title.native}</p>
            )}
            <TitleText
              romaji={media.title.romaji}
              english={media.title.english}
              className="font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"
            />

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              {score && (
                <span className="flex items-center gap-1.5 rounded-full bg-amber-400/10 px-3 py-1.5 font-bold text-amber-300">
                  <Star className="h-3.5 w-3.5 fill-amber-300" /> {score}
                </span>
              )}
              <span
                className={cn(
                  "rounded-full px-3 py-1.5 font-semibold",
                  media.status === "RELEASING"
                    ? "bg-emerald-400/10 text-emerald-300"
                    : media.status === "NOT_YET_RELEASED"
                      ? "bg-sky-400/10 text-sky-300"
                      : "bg-white/10 text-zinc-300",
                )}
              >
                {statusLabel(media.status)}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1.5 font-semibold text-zinc-300">
                {formatLabel(media.format)}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-zinc-300">
                <Layers className="h-3 w-3" />
                {media.status === "RELEASING" && media.nextAiringEpisode
                  ? `EP ${media.nextAiringEpisode.episode - 1} aired`
                  : total
                    ? `${total} episodes`
                    : "Episodes TBA"}
              </span>
              {media.duration ? (
                <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-zinc-300">
                  <Clock className="h-3 w-3" /> {media.duration} min
                </span>
              ) : null}
              <AiringCountdown
                airingAt={media.nextAiringEpisode ? media.nextAiringEpisode.airingAt : null}
                episode={media.nextAiringEpisode ? media.nextAiringEpisode.episode : null}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(media.genres ?? []).map((gen) => (
                <Link
                  key={gen}
                  href={`/genre/${encodeURIComponent(gen)}`}
                  className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:border-[#ff8a00]/50 hover:text-[#ffb86b]"
                >
                  {gen}
                </Link>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {watchHref && (
                <Link
                  href={watchHref}
                  className="group flex items-center gap-2.5 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-[#ff3d5a]/30 transition-transform hover:scale-[1.03] active:scale-95"
                >
                  <Play className="h-4 w-4 fill-white transition-transform group-hover:scale-125" />
                  {media.format === "MOVIE" ? "Watch Movie" : "Start Watching"}
                </Link>
              )}
              {media.trailer?.site === "youtube" && media.trailer.id && (
                <a
                  href={`https://www.youtube.com/watch?v=${media.trailer.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="glass flex items-center gap-2 rounded-full border border-white/15 px-5 py-3.5 text-sm font-semibold text-zinc-200 transition-all hover:border-red-400/50 hover:text-red-300"
                >
                  <MonitorPlay className="h-4 w-4" /> Trailer
                </a>
              )}
            </div>

            <p className="mt-3 text-[11px] text-zinc-600">
              {seasonLabel(media.season, media.seasonYear)}
              {media.studios?.nodes?.[0]?.name ? ` • ${media.studios.nodes[0].name}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-8 min-w-0">
          <h2 className="font-display mb-4 text-xl font-bold tracking-tight text-white">Synopsis</h2>
          <Description text={cleanDescription(media.description)} />

          {total > 0 && media.status !== "NOT_YET_RELEASED" && (
            <div className="mt-12">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-xl font-bold tracking-tight text-white">Episodes</h2>
                <span className="text-xs text-zinc-500">{total} available</span>
              </div>
              <EpisodeGrid animeId={media.id} total={total} />
            </div>
          )}

          {(media.relations?.edges?.length ?? 0) > 0 && (
            <div className="mt-12">
              <h2 className="font-display mb-4 text-xl font-bold tracking-tight text-white">Relations</h2>
              <div className="row-track no-scrollbar flex overflow-x-auto pb-2">
                {media.relations!.edges.map((e, i) => (
                  <Link
                    key={`${e.node.id}-${i}`}
                    href={`/anime/${e.node.id}`}
                    className="group flex w-[300px] shrink-0 items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-2 transition-all hover:border-[#ff8a00]/40 hover:bg-white/[0.06]"
                  >
                    <AnimeImage
                      sources={[e.node.coverImage?.extraLarge, e.node.coverImage?.large]}
                      alt={e.node.title.english ?? e.node.title.romaji ?? ""}
                      className="h-16 w-12 shrink-0 rounded-lg object-cover"
                    />
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#ffb86b]">
                        {(e.relationType ?? "Related").replace(/_/g, " ")}
                      </p>
                      <TitleText
                        romaji={e.node.title.romaji}
                        english={e.node.title.english}
                        as="span"
                        className="mt-1 line-clamp-2 block text-xs font-semibold text-zinc-200 group-hover:text-white"
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {recs.length > 0 && <Row title="You May Also Like" items={recs} />}
        </div>
        <div className="h-12" />
      </div>
    </div>
  );
}
