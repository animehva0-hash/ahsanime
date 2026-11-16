"use client";

import { useEffect, useState } from "react";
import { Clapperboard, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export default function StreamStats({
  animeId,
  episode,
  className,
}: {
  animeId: number;
  episode: number;
  className?: string;
}) {
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stats/${animeId}/${episode}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setViews(data.views ?? 0);
      })
      .catch(() => {
        if (!cancelled) setViews(0);
      });
    return () => {
      cancelled = true;
    };
  }, [animeId, episode]);

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-[11px] font-bold text-zinc-300",
        className,
      )}
    >
      <Eye className="h-3 w-3 text-[#ff8a00]" />
      <span>{views === null ? "--" : views.toLocaleString()}</span>
      <span className="px-1.5 text-zinc-500">views</span>
    </div>
  );
}
