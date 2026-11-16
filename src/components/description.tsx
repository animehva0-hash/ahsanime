"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export default function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;

  return (
    <div>
      <p
        className={cn(
          "whitespace-pre-line text-sm leading-relaxed text-zinc-400",
          !expanded && "line-clamp-4",
        )}
      >
        {text}
      </p>
      {text.length > 320 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-bold uppercase tracking-wider text-[#ffb86b] transition-colors hover:text-white"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
