"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { MediaCard } from "@/lib/anime-constants";
import AnimeCard from "./anime-card";

export default function InfiniteGrid({
  initial,
  initiallyHasNext,
  query,
  loadMoreFn,
}: {
  initial: MediaCard[];
  initiallyHasNext: boolean;
  query: Record<string, string>;
  /**
   * Browser-direct loader (visitor-IP quota). When provided, "load more" runs
   * in the browser instead of `/api/list` — used by the rate-limit fallbacks
   * so scrolling never touches the shared server quota.
   */
  loadMoreFn?: (page: number) => Promise<{ results: MediaCard[]; hasNext: boolean }>;
}) {
  const [items, setItems] = useState<MediaCard[]>(initial);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(initiallyHasNext);
  const [busy, setBusy] = useState(false);
  const [cooling, setCooling] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(initial.map((m) => m.id)));

  const loadMore = useCallback(async () => {
    if (busy || cooling || !hasNext) return;
    setBusy(true);
    try {
      if (loadMoreFn) {
        const { results, hasNext: more } = await loadMoreFn(page + 1);
        const fresh = results.filter((m) => !seen.current.has(m.id));
        fresh.forEach((m) => seen.current.add(m.id));
        setItems((prev) => [...prev, ...fresh]);
        setPage((p) => p + 1);
        setHasNext(more);
        return;
      }
      const params = new URLSearchParams({ ...query, page: String(page + 1) });
      const res = await fetch(`/api/list?${params.toString()}`);
      if (res.status === 429) {
        // Our own per-IP guard tripped — cool down 8s instead of spin-looping
        // and burning the shared AniList quota further.
        setCooling(true);
        setTimeout(() => setCooling(false), 8000);
        return;
      }
      const json = await res.json();
      const fresh: MediaCard[] = (json.results ?? []).filter(
        (m: MediaCard) => !seen.current.has(m.id),
      );
      fresh.forEach((m) => seen.current.add(m.id));
      setItems((prev) => [...prev, ...fresh]);
      setPage((p) => p + 1);
      setHasNext(Boolean(json.hasNext));
    } catch {
      /* keep state */
    } finally {
      setBusy(false);
    }
  }, [busy, cooling, hasNext, page, query, loadMoreFn]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const queryKey = JSON.stringify(query);

  // Reset when the underlying query changes.
  useEffect(() => {
    setItems(initial);
    setPage(1);
    setHasNext(initiallyHasNext);
    seen.current = new Set(initial.map((m) => m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  return (
    <div>
      <div className="grid-fluid">
        {items.map((m) => (
          <AnimeCard key={m.id} media={m} fluid />
        ))}
      </div>

      <div ref={sentinel} className="mt-8 flex items-center justify-center">
        {busy && <Loader2 className="h-6 w-6 animate-spin text-[#ff8a00]" />}
        {cooling && (
          <p className="text-xs text-zinc-500">Slowing down a moment…</p>
        )}
        {!hasNext && items.length > 0 && (
          <p className="text-xs text-zinc-600">You’ve reached the end.</p>
        )}
      </div>
    </div>
  );
}
