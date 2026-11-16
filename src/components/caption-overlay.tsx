"use client";

import { useMemo } from "react";

export type CaptionCue = { start: number; end: number; text: string };

/**
 * Custom caption layer.
 *
 * Styling (per spec): no background box, bold white text at 1.1em,
 * 1.5px black outline + drop shadow. Position: line=75 when the pointer is
 * over the player (controls visible), line=70 when it leaves.
 */
export default function CaptionOverlay({
  cues,
  currentTime,
  offset = 0,
  line = 75,
  style,
}: {
  cues: CaptionCue[] | null;
  currentTime: number;
  offset?: number;
  line: number;
  style?: React.CSSProperties;
}) {
  const t = currentTime - offset;

  const active = useMemo(() => {
    if (!cues || cues.length === 0) return [];
    const out: CaptionCue[] = [];
    for (const c of cues) {
      if (c.start <= t && t < c.end) out.push(c);
      if (out.length >= 2) break; // safety: max 2 stacked regions
    }
    return out;
  }, [cues, t]);

  if (!cues || active.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center justify-end px-[6%] text-center"
      style={{ top: 0, height: `${line}%`, transition: "height 220ms ease" }}
      aria-live="off"
    >
      {active.map((cue, idx) => (
        <div key={`${cue.start}-${idx}`} className="na-caption" dir="auto" style={style}>
          {cue.text.split("\n").map((lineText, i) => (
            <span key={i} className="block">
              {lineText}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
