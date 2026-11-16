"use client";

/**
 * Caption appearance settings (persisted per browser).
 * Shared by the HLS `<track>` renderer and the iframe caption overlay so both
 * players look identical.
 */

export type CaptionSettings = {
  /** Scale multiplier for the caption font. */
  size: number;
  /** Vertical position as a percentage of the video height (top-based). */
  position: number;
  /**
   * Per-user caption timing offset in milliseconds. Shifts every cue
   * forward (positive) or back (negative) so translated captions whose
   * timings were inherited from the English source can be re-aligned to
   * the video. Applied to the active caption track only.
   */
  offsetMs: number;
  /** Text colour. */
  color: string;
  /** Background style behind the text. */
  background: "none" | "shadow" | "box";
  bold: boolean;
  italic: boolean;
};

/** SSR-safe default (no localStorage access during render). */
export const captionSettingsStyleFallback: CaptionSettings = {
  size: 1,
  position: 92,
  offsetMs: 0,
  color: "#ffffff",
  background: "shadow",
  bold: true,
  italic: false,
};

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  size: 1,
  position: 92,
  offsetMs: 0,
  color: "#ffffff",
  background: "shadow",
  bold: true,
  italic: false,
};

const KEY = "na_caption_settings";

export function loadCaptionSettings(): CaptionSettings {
  if (typeof window === "undefined") return DEFAULT_CAPTION_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CAPTION_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CaptionSettings>;
    return {
      ...DEFAULT_CAPTION_SETTINGS,
      ...parsed,
      size: clampNum(parsed.size ?? 1, 0.6, 2.2),
      position: clampNum(parsed.position ?? 92, 20, 96),
      offsetMs: clampNum(parsed.offsetMs ?? 0, -5000, 5000),
    };
  } catch {
    return DEFAULT_CAPTION_SETTINGS;
  }
}

export function saveCaptionSettings(s: CaptionSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
}

function clampNum(v: number, min: number, max: number) {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
}

/** Inline styles for the custom caption overlay. */
export function captionOverlayStyle(s: CaptionSettings): React.CSSProperties {
  return {
    color: s.color,
    fontWeight: s.bold ? 800 : 500,
    fontStyle: s.italic ? "italic" : "normal",
    fontSize: `calc(clamp(0.95rem, 3.4vw, 1.25rem) * ${s.size})`,
    background:
      s.background === "box"
        ? "rgba(0,0,0,0.62)"
        : s.background === "shadow"
          ? "transparent"
          : "transparent",
    padding: s.background === "box" ? "0.15em 0.45em" : undefined,
    borderRadius: s.background === "box" ? "0.25em" : undefined,
    textShadow:
      s.background === "shadow"
        ? "-1.5px 0 0 #000,1.5px 0 0 #000,0 -1.5px 0 #000,0 1.5px 0 #000,.75px .75px 0 #000,-.75px -.75px 0 #000,.75px -.75px 0 #000,-.75px .75px 0 #000,0 3px 8px rgba(0,0,0,.85)"
        : s.background === "none"
          ? "none"
          : "-1.5px 0 0 #000,1.5px 0 0 #000,0 -1.5px 0 #000,0 1.5px 0 #000,0 3px 8px rgba(0,0,0,.85)",
  };
}

/** CSS text for the native `<track>` cue pseudo-element. */
export function captionCueCss(s: CaptionSettings): string {
  const shadow =
    s.background === "none"
      ? "none"
      : s.background === "box"
        ? "none"
        : "-1.5px 0 0 #000,1.5px 0 0 #000,0 -1.5px 0 #000,0 1.5px 0 #000,0 3px 8px rgba(0,0,0,.85)";

  return [
    "video::-webkit-media-text-track-display { padding: 0 1%; }",
    "video::cue {",
    `  background: ${s.background === "box" ? "rgba(0,0,0,.62)" : "transparent"};`,
    `  color: ${s.color};`,
    `  font-weight: ${s.bold ? 800 : 500};`,
    `  font-style: ${s.italic ? "italic" : "normal"};`,
    `  font-size: calc(clamp(0.95rem, 3.4vw, 1.25rem) * ${s.size});`,
    `  line-height: 1.3;`,
    `  text-shadow: ${shadow};`,
    "}",
  ].join("\n");
}
