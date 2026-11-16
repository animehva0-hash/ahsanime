"use client";

import Link from "next/link";
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import AnimeCard from "./anime-card";
import type { MediaCard } from "@/lib/anime-constants";

export default function Row({
  title,
  href,
  items,
  ranked = false,
}: {
  title: string;
  href?: string;
  items: MediaCard[];
  ranked?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);

  const scrollBy = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  if (!items.length) return null;

  return (
    <section className="group/row relative mt-6 sm:mt-10">
      <div className="mb-3 flex items-end justify-between pr-1 sm:mb-4">
        <h2 className="font-display flex items-center gap-2.5 text-base font-bold tracking-tight text-white sm:gap-3 sm:text-xl">
          <span className="h-4 w-1 rounded-full bg-gradient-to-b from-[#ff8a00] to-[#ff3d5a] sm:h-5" />
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {href && (
            <Link
              href={href}
              className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-[#ffb86b]"
            >
              View all
            </Link>
          )}
          <div className="hidden gap-1.5 sm:flex">
            <button
              onClick={() => scrollBy(-1)}
              className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-zinc-400 transition-all hover:border-[#ff8a00]/60 hover:text-[#ffb86b]"
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => scrollBy(1)}
              className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-zinc-400 transition-all hover:border-[#ff8a00]/60 hover:text-[#ffb86b]"
              aria-label="Scroll right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={track}
        className="row-track no-scrollbar flex snap-x snap-mandatory overflow-x-auto scroll-smooth pb-4 pt-2 sm:pb-8 sm:pt-4"
      >
        {items.map((m, i) => (
          <AnimeCard key={m.id} media={m} rank={ranked ? i + 1 : undefined} />
        ))}
      </div>
    </section>
  );
}
