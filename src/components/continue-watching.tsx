"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { History, Play, X } from "lucide-react";
import AnimeImage from "./anime-image";
import { useLang, useUid } from "./providers";

type HistoryItem = {
  animeId: number;
  episode: number;
  titleRomaji: string | null;
  titleEnglish: string | null;
  cover: string | null;
  color: string | null;
  watchedAt: string;
};

export default function ContinueWatching() {
  const uid = useUid();
  const { pick } = useLang();
  const [items, setItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    if (!uid) return;
    fetch("/api/history")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => setItems(j.items ?? []))
      .catch(() => setItems([]));
  }, [uid]);

  if (!items.length) return null;

  const remove = async (animeId: number) => {
    setItems((prev) => prev.filter((i) => i.animeId !== animeId));
    fetch(`/api/history?animeId=${animeId}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <section className="mt-6 sm:mt-10">
      <h2 className="font-display mb-3 flex items-center gap-2.5 text-base font-bold tracking-tight text-white sm:mb-4 sm:gap-3 sm:text-xl">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-[#ff8a00] to-[#ff3d5a]">
          <History className="h-3.5 w-3.5 text-white" />
        </span>
        Continue Watching
      </h2>
      <div className="rail-track no-scrollbar flex overflow-x-auto pb-4 pt-2 sm:pb-6 sm:pt-3">
        {items.map((it) => (
          <div
            key={it.animeId}
            className="group relative w-[240px] shrink-0 overflow-hidden rounded-2xl border border-white/10 transition-all duration-500 hover:-translate-y-1 hover:border-white/25 sm:w-[270px]"
          >
            <Link href={`/watch/${it.animeId}/${it.episode}`} className="block">
              <AnimeImage
                src={it.cover}
                alt={pick({ romaji: it.titleRomaji, english: it.titleEnglish })}
                className="h-28 w-full object-cover object-center transition-transform duration-700 group-hover:scale-105 sm:h-32"
                objectPosition="center 22%"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a14] via-[#0a0a14]/60 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3 sm:p-3.5">
                <p className="truncate text-[13px] font-semibold text-white sm:text-sm">
                  {pick({ romaji: it.titleRomaji, english: it.titleEnglish })}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-[#ff8a00]/20 px-2.5 py-0.5 text-[10px] font-bold text-[#ffb86b]">
                    <Play className="h-2.5 w-2.5 fill-[#ffb86b]" />
                    Continue EP {it.episode}
                  </span>
                </div>
              </div>
            </Link>
            <button
              onClick={() => remove(it.animeId)}
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-zinc-300 backdrop-blur transition-all hover:text-white sm:h-6 sm:w-6 sm:opacity-0 sm:group-hover:opacity-100"
              aria-label="Remove"
            >
              <X className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
