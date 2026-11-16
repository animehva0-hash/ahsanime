"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MangaYomi-style cover image (CachedNetworkImage equivalent for web).
 *
 * MangaYomi never does `<img src={url ?? ""}>`:
 * - covers load from a PRIORITY CHAIN (extraLarge → large → banner),
 * - a placeholder shows while loading,
 * - an errorWidget shows on failure instead of a broken-image icon,
 * - images are disk-cached per device.
 *
 * On web the browser cache is the disk cache. This component replicates the
 * rest: it walks the source chain on error and renders a branded gradient
 * placeholder when every source fails (or when AniList returned no URL at
 * all because of a 429). No more `src=""` requests against our own page URL
 * and no more invisible cards.
 */
export function coverSources(...urls: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = (u ?? "").trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export default function AnimeImage({
  sources,
  src,
  alt = "",
  className,
  style,
  eager = false,
  objectPosition,
}: {
  sources?: (string | null | undefined)[];
  src?: string | null | undefined;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  eager?: boolean;
  objectPosition?: string;
}) {
  const chain = coverSources(...(sources ?? []), src);
  const [idx, setIdx] = useState(0);
  const failed = idx >= chain.length;

  if (failed) {
    return (
      <div
        className={cn(
          "grid place-items-center bg-gradient-to-br from-[#2a1a08] via-[#1a0f14] to-[#0d0d18]",
          className,
        )}
        style={style}
        aria-label={alt || "Cover unavailable"}
        role="img"
      >
        <div className="flex flex-col items-center gap-1.5 p-2 text-center">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#ff8a00] to-[#ff3d5a] shadow-lg shadow-[#ff3d5a]/30">
            <ImageOff className="h-4 w-4 text-white" />
          </span>
          <span className="line-clamp-2 max-w-[90%] text-[10px] font-semibold leading-tight text-zinc-400">
            {alt || "Cover unavailable"}
          </span>
        </div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={chain[idx]}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      className={className}
      style={objectPosition ? { ...style, objectPosition } : style}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
