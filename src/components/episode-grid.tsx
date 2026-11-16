"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, Play, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export default function EpisodeGrid({
  animeId,
  total,
  current,
  compact = false,
}: {
  animeId: number;
  total: number;
  current?: number;
  compact?: boolean;
}) {
  const chunkSize = 100;
  const ranges = useMemo(() => {
    const out: { label: string; start: number; end: number }[] = [];
    for (let s = 1; s <= total; s += chunkSize) {
      out.push({ label: `${s} – ${Math.min(total, s + chunkSize - 1)}`, start: s, end: Math.min(total, s + chunkSize - 1) });
    }
    return out;
  }, [total]);

  const initial = useMemo(() => {
    if (!current) return 0;
    return ranges.findIndex((r) => current >= r.start && current <= r.end);
  }, [current, ranges]);

  const [rangeIdx, setRangeIdx] = useState(Math.max(0, initial));
  const range = ranges[rangeIdx];

  if (!range) return null;

  const eps: number[] = [];
  for (let e = range.start; e <= range.end; e++) eps.push(e);

  return (
    <div>
      {ranges.length > 1 && (
        <div className="relative mb-4 inline-block">
          <select
            value={rangeIdx}
            onChange={(e) => setRangeIdx(Number(e.target.value))}
            className="appearance-none rounded-full border border-white/10 bg-white/5 py-2 pl-4 pr-10 text-xs font-semibold text-zinc-300 outline-none focus:border-[#ff8a00]/60"
          >
            {ranges.map((r, i) => (
              <option key={r.label} value={i} className="bg-[#12121e]">
                Episodes {r.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        </div>
      )}

      <div
        className={cn(
          "grid gap-1.5",
          compact
            ? "max-h-[500px] grid-cols-2 overflow-y-auto pr-1 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5"
            : "grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 md:grid-cols-6 lg:grid-cols-8",
        )}
      >
        {eps.map((ep) => {
          const isCurrent = ep === current;
          const isLatest = total === ep;
          return (
            <Link
              key={ep}
              href={`/watch/${animeId}/${ep}`}
              className={cn(
                "group relative flex h-10 w-full items-center justify-center rounded-xl border text-[11px] font-bold transition-all duration-300 xs:h-9 xs:text-xs",
                isCurrent
                  ? "border-[#ff8a00] bg-gradient-to-br from-[#ff8a00] to-[#ff3d5a] text-white shadow-lg shadow-[#ff3d5a]/30"
                  : "border-white/10 bg-white/[0.04] text-zinc-400 hover:-translate-y-0.5 hover:border-[#ff8a00]/50 hover:text-white",
              )}
            >
              <span className="flex items-center gap-1">
                {!isCurrent && (
                  <Play className="h-2.5 w-2.5 fill-current opacity-0 transition-opacity group-hover:opacity-100" />
                )}
                {ep}
              </span>
              {isLatest && total > 1 && (
                <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-[#ff3d5a] text-white">
                  <Radio className="h-2.5 w-2.5" />
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
