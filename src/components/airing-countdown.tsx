"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

/** Live ticking countdown for the next airing episode. */
export default function AiringCountdown({
  airingAt,
  episode,
}: {
  airingAt: number | null | undefined;
  episode: number | null | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!airingAt || !episode) return null;
  const diff = airingAt * 1000 - now;
  if (diff <= 0) return null;

  const days = Math.floor(diff / 86_400_000);
  const hrs = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1000);

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  parts.push(`${String(hrs).padStart(2, "0")}h`);
  parts.push(`${String(mins).padStart(2, "0")}m`);
  parts.push(`${String(secs).padStart(2, "0")}s`);

  return (
    <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1.5 font-semibold tabular-nums text-emerald-300">
      <Timer className="h-3 w-3" />
      Next EP {episode} in {parts.join(" ")}
    </span>
  );
}
