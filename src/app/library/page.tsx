"use client";

import { useEffect, useState } from "react";
import { Bookmark, History, LibraryBig, Loader2, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import AnimeCard from "@/components/anime-card";
import AnimeImage from "@/components/anime-image";
import { useLang, useUid } from "@/components/providers";
import type { MediaCard } from "@/lib/anime-constants";
import { cn } from "@/lib/utils";

type WatchlistItem = {
  animeId: number;
  titleRomaji: string | null;
  titleEnglish: string | null;
  cover: string | null;
  color: string | null;
  format: string | null;
  status: string | null;
  score: number | null;
  episode: number | null;
};

type HistoryItem = WatchlistItem & { episode: number; watchedAt: string };

function toCard(i: WatchlistItem): MediaCard {
  return {
    id: i.animeId,
    idMal: null,
    title: { romaji: i.titleRomaji, english: i.titleEnglish, native: null },
    coverImage: { extraLarge: i.cover, large: i.cover, color: i.color },
    bannerImage: null,
    format: i.format,
    status: i.status,
    episodes: null,
    duration: null,
    averageScore: i.score,
    popularity: null,
    seasonYear: null,
    season: null,
    genres: null,
    description: null,
    nextAiringEpisode: null,
    trending: null,
    startDate: null,
  };
}

export default function LibraryPage() {
  const uid = useUid();
  const { pick } = useLang();
  const [tab, setTab] = useState<"list" | "history">("list");
  const [list, setList] = useState<WatchlistItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    Promise.all([
      fetch("/api/watchlist").then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
      fetch("/api/history").then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
    ]).then(([wl, hs]) => {
      setList(wl.items ?? []);
      setHistory(hs.items ?? []);
      setLoading(false);
    });
  }, [uid]);

  const removeFromList = (animeId: number) => {
    setList((p) => p.filter((i) => i.animeId !== animeId));
    fetch(`/api/watchlist?animeId=${animeId}`, { method: "DELETE" }).catch(() => {});
  };
  const removeFromHistory = (animeId: number) => {
    setHistory((p) => p.filter((i) => i.animeId !== animeId));
    fetch(`/api/history?animeId=${animeId}`, { method: "DELETE" }).catch(() => {});
  };
  const clearHistory = () => {
    history.forEach((i) =>
      fetch(`/api/history?animeId=${i.animeId}`, { method: "DELETE" }).catch(() => {}),
    );
    setHistory([]);
  };

  return (
    <div className="shell">
      <div className="mb-8 mt-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#ffb86b]">
          Your space
        </p>
        <h1 className="font-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          <LibraryBig className="h-8 w-8 text-[#ff8a00]" /> Watchlist
        </h1>
        <div className="mt-5 h-px bg-gradient-to-r from-[#ff8a00]/60 via-[#ff3d5a]/30 to-transparent" />
      </div>

      <div className="mb-8 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1 sm:w-fit">
        <button
          onClick={() => setTab("list")}
          className={cn(
            "flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold transition-all",
            tab === "list"
              ? "bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] text-white shadow"
              : "text-zinc-400 hover:text-white",
          )}
        >
          <Bookmark className="h-3.5 w-3.5" /> Watchlist
          <span className="rounded-full bg-black/30 px-1.5 text-[10px]">{list.length}</span>
        </button>
        {tab === "history" && history.length > 0 && (
          <button
            onClick={clearHistory}
            className="ml-1 flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold text-zinc-500 transition-colors hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex h-56 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#ff8a00]" />
        </div>
      ) : tab === "list" ? (
        list.length === 0 ? (
          <EmptyState
            title="Your watchlist is empty"
            body="Start watching an anime and it will appear here so you can resume later."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((item) => (
              <div
                key={item.animeId}
                className="group relative overflow-hidden rounded-2xl border border-white/10 transition-all hover:border-white/25"
              >
                <Link href={`/watch/${item.animeId}/${item.episode ?? 1}`} className="flex">
                  <AnimeImage
                    src={item.cover}
                    alt={pick({ romaji: item.titleRomaji, english: item.titleEnglish })}
                    className="h-28 w-20 shrink-0 object-cover object-center"
                    objectPosition="center 20%"
                  />
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-3">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {pick({ romaji: item.titleRomaji, english: item.titleEnglish })}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {item.episode ? `Watched up to episode ${item.episode}` : "Not started"}
                    </p>
                    <span className="mt-1 w-fit rounded-full bg-[#ff8a00]/15 px-2.5 py-0.5 text-[10px] font-bold text-[#ffb86b]">
                      Resume
                    </span>
                  </div>
                </Link>
                <button
                  onClick={() => removeFromList(item.animeId)}
                  className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-zinc-400 opacity-0 transition-all hover:text-white group-hover:opacity-100"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )
      ) : history.length === 0 ? (
        <EmptyState
          title="Nothing watched yet"
          body="Start an episode anywhere on the site and it will appear here so you can resume later."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {history.map((it) => (
            <div
              key={it.animeId}
              className="group relative overflow-hidden rounded-2xl border border-white/10 transition-all hover:border-white/25"
            >
              <Link href={`/watch/${it.animeId}/${it.episode}`} className="flex">
                <AnimeImage
                  src={it.cover}
                  alt={pick({ romaji: it.titleRomaji, english: it.titleEnglish })}
                  className="h-28 w-20 shrink-0 object-cover object-center"
                  objectPosition="center 20%"
                />
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-3">
                  <p className="truncate text-sm font-semibold text-zinc-100">
                    {pick({ romaji: it.titleRomaji, english: it.titleEnglish })}
                  </p>
                  <p className="text-xs text-zinc-500">Watched up to episode {it.episode}</p>
                  <span className="mt-1 w-fit rounded-full bg-[#ff8a00]/15 px-2.5 py-0.5 text-[10px] font-bold text-[#ffb86b]">
                    Resume
                  </span>
                </div>
              </Link>
              <button
                onClick={() => removeFromHistory(it.animeId)}
                className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-zinc-400 opacity-0 transition-all hover:text-white group-hover:opacity-100"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="h-14" />
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 text-center">
      <Sparkles className="h-8 w-8 text-zinc-600" />
      <p className="mt-3 text-sm font-semibold text-zinc-300">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-zinc-600">{body}</p>
      <Link
        href="/discover/popular"
        className="mt-5 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-6 py-2.5 text-xs font-bold text-white"
      >
        Explore Popular
      </Link>
    </div>
  );
}
