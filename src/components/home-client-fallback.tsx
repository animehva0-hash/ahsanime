"use client";

/**
 * Home fallback — runs ONLY when the server couldn't serve AniList data
 * (shared server-IP quota over). Fetches DIRECTLY from the visitor's browser,
 * so the request goes out on the VISITOR'S IP with their OWN quota —
 * MangaYomi model (har device apni IP). The old code showed a dead
 * "AniList is catching its breath" page here instead.
 */

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Wifi } from "lucide-react";
import { browserGetHome, type HomeData } from "@/lib/anilist-client";
import { seasonLabel } from "@/lib/utils";
import Spotlight from "@/components/spotlight";
import Row from "@/components/row";
import ContinueWatching from "@/components/continue-watching";

function Skeleton() {
  return (
    <div className="shell animate-pulse">
      <div className="pt-3 sm:pt-5">
        <div className="h-[72svh] min-h-[440px] w-full rounded-b-[2rem] bg-white/5 sm:h-[560px] sm:rounded-[2rem]" />
      </div>
      {[0, 1, 2].map((r) => (
        <div key={r} className="mt-10">
          <div className="mb-4 h-6 w-44 rounded-full bg-white/5" />
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3, 4, 5].map((c) => (
              <div key={c} className="aspect-[2/3] w-36 shrink-0 rounded-2xl bg-white/5 sm:w-44" />
            ))}
          </div>
        </div>
      ))}
      <div className="h-10" />
    </div>
  );
}

export default function HomeClientFallback() {
  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await browserGetHome());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  if (data) {
    return (
      <div className="shell">
        <div className="pt-3 sm:pt-5">
          <Spotlight items={data.trending} />
        </div>
        <ContinueWatching />
        <Row title="Trending Now" items={data.trending} href="/discover/trending" />
        <Row title="Latest Updates" items={data.latestUpdated} href="/discover/updated" />
        <Row
          title={`Popular — ${seasonLabel(data.season, data.seasonYear)}`}
          items={data.seasonNow}
          href="/discover/ongoing"
        />
        <Row title="Coming Soon" items={data.upcoming} href="/discover/upcoming" />
        <Row title="All Time Legends" items={data.topAllTime} href="/discover/popular" ranked />
        <div className="h-10" />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#ff8a00] to-[#ff3d5a] shadow-xl shadow-[#ff3d5a]/30">
          <Wifi className="h-7 w-7 text-white" />
        </div>
        <h1 className="font-display mt-7 text-2xl font-bold text-white">
          AniList is catching its breath
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-500">
          Hamara server quota aur tumhara connection — dono se try kiya, par
          AniList abhi jawab nahi de raha. Thodi der me{" "}
          <span className="text-zinc-300">neeche button se retry</span> karo.
        </p>
        <div className="mt-7">
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#ff3d5a]/30 transition-transform hover:scale-105 active:scale-95"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
        <p className="mt-6 text-[11px] text-zinc-600">
          Watch history aur watchlist is dauraan bhi available rehti hai.
        </p>
      </div>
    );
  }

  return <Skeleton />;
}
