"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Keeps the site fresh without a manual reload.
 *
 * Every 10 minutes (and whenever the tab becomes visible again after being
 * hidden for that long) the current route is revalidated, so newly aired
 * episodes and updated lists appear on their own.
 */
export default function AutoRefresh({ intervalMs = 600_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const lastRef = useRef(Date.now());
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    const refresh = () => {
      lastRef.current = Date.now();
      setPulsing(true);
      router.refresh();
      setTimeout(() => setPulsing(false), 1600);
    };

    const tick = setInterval(() => {
      // Skip refreshing while the user is actively watching in a hidden tab.
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);

    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRef.current >= intervalMs
      ) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);

  if (!pulsing) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[10px] font-bold text-zinc-300 backdrop-blur animate-fade-in">
      <RefreshCw className="h-3 w-3 animate-spin text-[#ffb86b]" />
      Checking for new episodes…
    </div>
  );
}
