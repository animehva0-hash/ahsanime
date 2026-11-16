"use client";

import { useEffect, useState } from "react";
import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ActivityItem = {
  uid: string;
  animeId: number;
  episode: number;
  titleRomaji?: string | null;
  titleEnglish?: string | null;
  cover?: string | null;
  mode?: string;
  watchedAt: string;
};

export default function ActivityFeed({
  limit = 12,
  className,
}: {
  limit?: number;
  className?: string;
}) {
  const [items, setItems] = useState<ActivityItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/activity", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled)
          setItems((data.items ?? []).slice(0, limit));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  if (items.length === 0) {
    return (
      <div className={cn("rounded-2xl border border-white/5 bg-white/[0.02] p-4", className)}>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <Clapperboard className="h-3.5 w-3.5 text-[#ff8a00]" />
          <span className="font-semibold">No one watching right now</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl border border-white/5 bg-white/[0.02] p-4", className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#ffb86b]">
          <Clapperboard className="h-3 w-3" />
          <span>Live activity</span>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
          >
            {item.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.cover}
                alt=""
                className="h-8 w-6 rounded object-cover"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="h-8 w-6 rounded bg-gradient-to-br from-[#2a1a08] via-[#1a0f14] to-[#0d0d18] flex items-center justify-center">
                <span className="text-[8px] font-bold text-zinc-500">-</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Link
                href={`/watch/${item.animeId}/${item.episode}`}
                className="block text-[10px] font-bold text-zinc-200 truncate group-hover:text-white"
                title={item.titleEnglish ?? item.titleRomaji ?? ""}
              >
                {item.titleEnglish ?? item.titleRomaji ?? "Anime"}
              </Link>
              <div className="flex items-center gap-1 text-[9px] text-zinc-500">
                <span>{`EP ${item.episode}`}</span>
                <span className="px-1 text-white/30">•</span>
                <span>{item.mode ?? "sub"}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
