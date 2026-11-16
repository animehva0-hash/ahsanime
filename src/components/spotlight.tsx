"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, Clapperboard, Flame, Info, Play, Star } from "lucide-react";
import type { MediaCard } from "@/lib/anime-constants";
import { useLang } from "./providers";
import AnimeImage from "./anime-image";
import { cn, cleanDescription, formatLabel, scoreLabel } from "@/lib/utils";

export default function Spotlight({ items }: { items: MediaCard[] }) {
  const slides = items.filter((m) => m.bannerImage || m.coverImage?.extraLarge).slice(0, 6);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const { pick } = useLang();

  const go = useCallback(
    (next: number) => setIndex(((next % slides.length) + slides.length) % slides.length),
    [slides.length],
  );

  useEffect(() => {
    if (paused || slides.length < 2) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % slides.length), 7000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused, slides.length]);

  if (!slides.length) return null;
  const media = slides[index];
  const title = pick(media.title);
  const score = scoreLabel(media.averageScore);

  return (
    <section
      className="relative -mx-[var(--gutter)] overflow-hidden sm:mx-0 sm:rounded-[2rem] sm:border sm:border-white/10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative h-[52svh] min-h-[320px] w-full sm:h-[560px] sm:min-h-[440px]">
        {slides.map((m, i) => (
          <div
            key={m.id}
            className={cn(
              "absolute inset-0 transition-opacity duration-[1200ms] ease-out",
              i === index ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <AnimeImage
              sources={[m.bannerImage, m.coverImage?.extraLarge, m.coverImage?.large]}
              alt=""
              eager={i === 0}
              className={cn(
                "h-full w-full object-cover",
                i === index && "animate-ken-burns",
              )}
            />
            {/* cinematic gradients */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#07070d] via-[#07070d]/70 to-[#07070d]/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#07070d] via-transparent to-[#07070d]/40" />
            <div
              className="absolute inset-0 opacity-30 mix-blend-overlay"
              style={{
                background: `radial-gradient(900px 400px at 70% 20%, ${m.coverImage?.color ?? "#ff8a00"}55, transparent 60%)`,
              }}
            />
          </div>
        ))}

        {/* Content */}
        <div className="absolute inset-0 mx-auto flex max-w-[1440px] items-end px-4 pb-14 sm:items-center sm:px-6 sm:pb-0 lg:px-8">
          <div key={media.id} className="max-w-2xl animate-fade-up">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-[#ffb86b] sm:mb-3">
              <Flame className="h-3.5 w-3.5" />
              #{index + 1} Trending
            </div>
            <h1 className="font-display line-clamp-2 font-bold leading-[1.02] tracking-tight text-white drop-shadow-xl sm:line-clamp-none" style={{ fontSize: "var(--fs-hero)" }}>
              {title}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-zinc-300 sm:mt-4 sm:gap-x-4 sm:gap-y-2 sm:text-xs">
              {score && (
                <span className="flex items-center gap-1 font-semibold text-amber-300">
                  <Star className="h-3.5 w-3.5 fill-amber-300" /> {score}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Clapperboard className="h-3.5 w-3.5 text-zinc-400" />
                {formatLabel(media.format)}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                {media.seasonYear ?? "TBA"}
              </span>
              {media.episodes ? (
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
                  {media.episodes} ep
                </span>
              ) : null}
            </div>

            <p className="mt-3 line-clamp-2 max-w-xl text-[13px] leading-relaxed text-zinc-400 sm:mt-4 sm:line-clamp-3 sm:text-sm">
              {cleanDescription(media.description, 280)}
            </p>

            <div className="mt-4 flex items-center gap-2.5 sm:mt-7 sm:gap-3">
              <Link
                href={`/watch/${media.id}/1`}
                className="pulse-ring group flex items-center gap-2 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-5 py-3 text-sm font-bold text-white shadow-xl shadow-[#ff3d5a]/30 transition-transform duration-300 hover:scale-[1.03] active:scale-95 sm:gap-2.5 sm:px-7 sm:py-3.5"
              >
                <Play className="h-4 w-4 fill-white transition-transform group-hover:scale-125" />
                Watch
              </Link>
              <Link
                href={`/anime/${media.id}`}
                className="glass flex items-center gap-2 rounded-full border border-white/15 px-4 py-3 text-sm font-semibold text-zinc-200 transition-all hover:border-white/40 hover:bg-white/10 sm:px-6 sm:py-3.5"
              >
                <Info className="h-4 w-4" />
                Info
              </Link>
            </div>
          </div>
        </div>

        {/* Slide navigation */}
        <div className="absolute bottom-6 right-4 flex items-center gap-2 sm:right-8 lg:right-12">
          <button
            onClick={() => go(index - 1)}
            className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/40 text-zinc-300 backdrop-blur transition-all hover:border-[#ff8a00]/60 hover:text-[#ffb86b]"
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {slides.map((m, i) => (
            <button
              key={m.id}
              onClick={() => go(i)}
              aria-label={`Slide ${i + 1}`}
              className={cn(
                "relative hidden h-11 w-8 overflow-hidden rounded-md border transition-all duration-300 sm:block",
                i === index
                  ? "scale-110 border-[#ff8a00] shadow-lg shadow-[#ff8a00]/30"
                  : "border-white/20 opacity-50 hover:opacity-90",
              )}
            >
              <AnimeImage
                sources={[m.coverImage?.extraLarge, m.coverImage?.large, m.bannerImage]}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          ))}
          <button
            onClick={() => go(index + 1)}
            className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/40 text-zinc-300 backdrop-blur transition-all hover:border-[#ff8a00]/60 hover:text-[#ffb86b]"
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Progress dots (mobile) */}
        <div className="absolute bottom-7 left-4 flex gap-1.5 sm:hidden">
          {slides.map((m, i) => (
            <span
              key={m.id}
              className={cn(
                "h-1 rounded-full transition-all duration-500",
                i === index ? "w-6 bg-[#ff8a00]" : "w-1.5 bg-white/30",
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
