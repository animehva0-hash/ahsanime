"use client";

import Link from "next/link";
import { Clapperboard, Play, Star } from "lucide-react";
import type { MediaCard } from "@/lib/anime-constants";
import { useLang } from "./providers";
import AnimeImage from "./anime-image";
import { cn, formatLabel, scoreLabel } from "@/lib/utils";

export default function AnimeCard({
  media,
  rank,
  fluid = false,
  className,
}: {
  media: MediaCard;
  rank?: number;
  fluid?: boolean;
  className?: string;
}) {
  const { lang, pick } = useLang();
  const title = pick(media.title);
  const color = media.coverImage?.color ?? "#ff8a00";
  const score = scoreLabel(media.averageScore);
  const eps =
    media.status === "RELEASING" && media.nextAiringEpisode
      ? media.nextAiringEpisode.episode - 1
      : media.episodes;

  return (
    <Link
      href={`/anime/${media.id}`}
      className={cn(
        "group/card block",
        fluid ? "card-fluid w-full" : "card-fluid shrink-0",
        className,
      )}
    >
      <div
        className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/10 bg-white/5 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:-translate-y-1.5 group-hover/card:border-white/25 sm:rounded-2xl"
        style={{
          boxShadow: "0 8px 30px -12px rgba(0,0,0,0.8)",
        }}
      >
        <AnimeImage
          sources={[media.coverImage?.large, media.coverImage?.extraLarge, media.bannerImage]}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover/card:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/20 opacity-80 transition-opacity duration-500 group-hover/card:opacity-95" />

        {typeof rank === "number" && (
          <div className="font-display absolute -left-1 -top-1 z-10 grid h-8 min-w-8 place-items-center rounded-br-2xl bg-gradient-to-br from-[#ff8a00] to-[#ff3d5a] px-1.5 text-sm font-bold text-white shadow-lg">
            {rank}
          </div>
        )}

        {score && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-amber-300" />
            {score}
          </div>
        )}

        {/* Hover info overlay */}
        <div className="absolute inset-x-0 bottom-0 translate-y-3 p-3 opacity-90 transition-all duration-500 group-hover/card:translate-y-0 group-hover/card:opacity-100">
          <div className="mb-1.5 flex flex-wrap gap-1 text-[9px] font-semibold uppercase tracking-wider">
            <span className="rounded bg-white/15 px-1.5 py-0.5 text-zinc-200 backdrop-blur-sm">
              {formatLabel(media.format)}
            </span>
            {eps ? (
              <span className="flex items-center gap-0.5 rounded bg-white/15 px-1.5 py-0.5 text-zinc-200 backdrop-blur-sm">
                <Clapperboard className="h-2.5 w-2.5" /> {eps}
                {media.status === "RELEASING" ? "+" : ""}
              </span>
            ) : null}
          </div>
          <div className="hidden flex-wrap gap-1 opacity-0 transition-opacity duration-500 group-hover/card:opacity-100 sm:flex">
            {(media.genres ?? []).slice(0, 3).map((g) => (
              <span
                key={g}
                className="rounded-full border border-white/20 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-zinc-300"
              >
                {g}
              </span>
            ))}
          </div>
          <div className="mt-2 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#ff8a00] to-[#ff3d5a] opacity-0 shadow-lg shadow-[#ff3d5a]/40 transition-all duration-500 group-hover/card:opacity-100">
            <Play className="h-3.5 w-3.5 fill-white text-white" />
          </div>
        </div>

        {/* Colored glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/card:opacity-100"
          style={{ boxShadow: `inset 0 0 0 1px ${color}66, 0 20px 40px -18px ${color}88` }}
        />
      </div>

      <div className="mt-2.5 px-0.5">
        <p
          className={cn(
            "truncate text-[13px] font-semibold leading-snug text-zinc-200 transition-colors group-hover/card:text-white",
            lang === "jp" && "tracking-tight",
          )}
          title={title}
        >
          {title}
        </p>
        <p className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-zinc-500">
          {media.seasonYear ?? "TBA"} • {formatLabel(media.format)}
        </p>
      </div>
    </Link>
  );
}
