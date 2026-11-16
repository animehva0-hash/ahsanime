"use client";

/**
 * Generic list fallback for discover / genre / type / search pages.
 * Server quota over → this fetches page 1 + further pages DIRECTLY from the
 * visitor's browser (their own IP/quota) and renders the same InfiniteGrid.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import {
  browserSearch,
  type ClientListParams,
  type MediaCard,
} from "@/lib/anilist-client";
import InfiniteGrid from "@/components/infinite-grid";

export default function ListClientFallback({
  params,
  queryKey,
}: {
  params: ClientListParams;
  queryKey: Record<string, string>;
}) {
  const [items, setItems] = useState<MediaCard[] | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setFailed(false);
    browserSearch({ ...params, page: 1 })
      .then((res) => {
        if (cancelled) return;
        if (!res.media.length) setFailed(true);
        else {
          setItems(res.media);
          setHasNext(Boolean(res.pageInfo?.hasNextPage));
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, JSON.stringify(params)]);

  const loadMoreFn = useCallback(
    async (page: number) => {
      const res = await browserSearch({ ...params, page });
      return { results: res.media, hasNext: Boolean(res.pageInfo?.hasNextPage) };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(params)],
  );

  if (items) {
    return <InfiniteGrid initial={items} initiallyHasNext={hasNext} query={queryKey} loadMoreFn={loadMoreFn} />;
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <p className="text-sm text-zinc-500">
          AniList abhi jawab nahi de raha — server se bhi try kiya, tumhare
          connection se bhi. Thodi der me retry karo.
        </p>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="mt-5 flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-xs font-semibold text-zinc-200 transition-all hover:border-[#ff8a00]/50 hover:text-[#ffb86b]"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-[#ff8a00]" />
    </div>
  );
}
