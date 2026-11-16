"use client";

import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { useUid } from "./providers";
import { cn } from "@/lib/utils";

type Payload = {
  animeId: number;
  titleRomaji?: string | null;
  titleEnglish?: string | null;
  cover?: string | null;
  color?: string | null;
  format?: string | null;
  status?: string | null;
  score?: number | null;
};

export default function WatchlistButton({
  anime,
  iconOnly = false,
}: {
  anime: Payload;
  iconOnly?: boolean;
}) {
  const uid = useUid();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    fetch("/api/watchlist")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => {
        if (cancelled) return;
        setSaved((j.items ?? []).some((i: { animeId: number }) => i.animeId === anime.animeId));
        setReady(true);
      })
      .catch(() => setReady(true));
    return () => {
      cancelled = true;
    };
  }, [uid, anime.animeId]);

  const toggle = async () => {
    if (busy || !uid) return;
    setBusy(true);
    const next = !saved;
    setSaved(next); // optimistic
     try {
       if (next) {
         const res = await fetch("/api/watchlist", {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify(anime),
         });
         if (!res.ok) throw new Error("save failed");
       } else {
         const res = await fetch(`/api/watchlist?animeId=${anime.animeId}`, { method: "DELETE" });
         if (!res.ok) throw new Error("delete failed");
       }
     } catch {
       setSaved(!next);
     } finally {
      setBusy(false);
    }
  };

  const Icon = busy ? Loader2 : saved ? BookmarkCheck : Bookmark;

  if (iconOnly) {
    return (
      <button
        onClick={toggle}
        disabled={!ready || busy}
        title={saved ? "Remove from library" : "Save to library"}
        className={cn(
          "grid h-10 w-10 place-items-center rounded-full border transition-all",
          saved
            ? "border-[#ff8a00]/60 bg-[#ff8a00]/15 text-[#ffb86b]"
            : "border-white/15 bg-white/5 text-zinc-300 hover:border-[#ff8a00]/50 hover:text-[#ffb86b]",
        )}
      >
        <Icon className={cn("h-4 w-4", busy && "animate-spin")} />
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={!ready || busy}
      className={cn(
        "flex items-center gap-2 rounded-full border px-6 py-3.5 text-sm font-semibold transition-all duration-300 active:scale-95",
        saved
          ? "border-[#ff8a00]/60 bg-[#ff8a00]/15 text-[#ffb86b]"
          : "glass border-white/15 text-zinc-200 hover:border-white/40 hover:bg-white/10",
      )}
    >
      <Icon className={cn("h-4 w-4", busy && "animate-spin", saved && "fill-[#ffb86b]")} />
      {saved ? "In Library" : "Add to Library"}
    </button>
  );
}
