/**
 * Subtitle parsing / serialization utilities.
 * Accepts WebVTT, SubRip (.srt) and basic ASS dialogue; always emits valid VTT.
 */

export type VttCue = {
  id: number;
  start: number; // seconds
  end: number; // seconds
  text: string; // possibly multi-line
  /** True when this cue carries model output (not a source fallback). */
  translated?: boolean;
};

/** "00:00:01.000" | "00:01.000" | SRT "00:00:01,000" -> seconds */
export function parseTimestamp(raw: string): number {
  const t = raw.trim().replace(",", ".");
  const parts = t.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Number(h) * 3600 + Number(m) * 60 + parseFloat(s);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return Number(m) * 60 + parseFloat(s);
  }
  return parseFloat(t) || 0;
}

export function formatTimestamp(sec: number, withHours = true): string {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toFixed(3).padStart(6, "0");
  const mm = String(m).padStart(2, "0");
  return withHours ? `${String(h).padStart(2, "0")}:${mm}:${s}` : `${mm}:${s}`;
}

/** Strip ASS override tags {\...}, HTML-ish tags and styles from a line. */
export function stripTags(line: string): string {
  return line
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\N/gi, " ")
    .replace(/\\h/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalise typographic glyphs that render inconsistently across caption
 * pipelines (Gemini often emits smart quotes / fullwidth forms).
 * - smart quotes & apostrophes → ASCII
 * - fullwidth punctuation → ASCII
 * - stray zero-width / BOM / control characters → removed
 */
export function normaliseGlyphs(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2026]/g, "...")
    .replace(/[\uFF01\uFF1F\uFF0C\uFF1B\uFF1A]/g, (c) =>
      ({ "\uFF01": "!", "\uFF1F": "?", "\uFF0C": ",", "\uFF1B": ";", "\uFF1A": ":" })[c] ?? c,
    )
    .replace(/[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    // collapse doubled spaces created by the removals above
    .replace(/[ \t]+/g, " ")
    .trim();
}

const TIMING_RE =
  /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;

export function parseVtt(raw: string): VttCue[] {
  const text = raw.replace(/^\uFEFF/, "");
  const cues: VttCue[] = [];

  if (text.includes("[Events]")) return parseAss(text);

  const blocks = text.split(/\r?\n\s*\r?\n/);
  let id = 0;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (!lines.length) continue;
    if (/^WEBVTT/i.test(lines[0]) || /^NOTE/.test(lines[0]) || /^STYLE/.test(lines[0])) continue;

    let timingIdx = lines.findIndex((l) => TIMING_RE.test(l));
    if (timingIdx === -1) continue;
    const timing = lines[timingIdx];
    const m = timing.split(/\s*-->\s*/);
    if (m.length < 2) continue;
    const start = parseTimestamp(m[0]);
    // strip position/align settings from the end stamp
    const end = parseTimestamp(m[1].split(/\s/)[0]);
    const body = lines.slice(timingIdx + 1).map(stripTags).filter(Boolean).join("\n");
    if (!body || end <= start) continue;
    cues.push({ id: ++id, start, end, text: body });
  }
  return cues;
}

/** Basic ASS -> cues (Dialogue events only). */
function parseAss(text: string): VttCue[] {
  const events = text.split("[Events]")[1] ?? "";
  const formatLine = events.match(/^\s*Format:\s*(.+)$/im);
  const fields = formatLine
    ? formatLine[1].split(",").map((f) => f.trim().toLowerCase())
    : ["start", "end", "text"];
  const iStart = fields.indexOf("start");
  const iEnd = fields.indexOf("end");
  const iText = fields.lastIndexOf("text");

  const cues: VttCue[] = [];
  let id = 0;
  for (const line of events.split(/\r?\n/)) {
    if (!/^\s*Dialogue:/i.test(line)) continue;
    const payload = line.replace(/^\s*Dialogue:\s*/i, "");
    const parts = payload.split(",");
    if (parts.length <= Math.max(iStart, iEnd)) continue;
    // text field takes the remainder (commas allowed)
    const start = parseTimestamp(parts[iStart] ?? "");
    const end = parseTimestamp(parts[iEnd] ?? "");
    const textRaw = parts.slice(iText).join(",");
    const body = stripTags(textRaw.replace(/\\[Nnh]/g, " "));
    if (!body || end <= start || isNaN(start) || isNaN(end)) continue;
    cues.push({ id: ++id, start, end, text: body });
  }
  return cues;
}

/**
 * Timing-safety pass for translation.
 *
 * Anime subs often carry sign/typeset cues that overlap the spoken dialogue.
 * When those are translated as separate cues they visually fight with the
 * dialogue line and look "out of sync". Merging cues that share (almost) the
 * same window keeps one cue per time slot, so translated text can never drift
 * away from the original timing.
 */
export function mergeOverlappingCues(cues: VttCue[], tolerance = 0.15): VttCue[] {
  if (cues.length < 2) return cues;
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: VttCue[] = [];

  for (const cue of sorted) {
    const prev = out[out.length - 1];
    const sameSlot =
      prev &&
      Math.abs(prev.start - cue.start) <= tolerance &&
      Math.abs(prev.end - cue.end) <= tolerance;
    if (sameSlot) {
      if (!prev.text.includes(cue.text)) prev.text = `${prev.text}\n${cue.text}`;
      prev.end = Math.max(prev.end, cue.end);
      continue;
    }
    out.push({ ...cue });
  }

  // Never let a cue overlap the next one's start (keeps captions 1-at-a-time).
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].end > out[i + 1].start) out[i].end = out[i + 1].start;
  }

  return out.filter((c) => c.end > c.start).map((c, i) => ({ ...c, id: i + 1 }));
}

/**
 * Shift every cue's start/end by `delta` seconds (negative = earlier,
 * positive = later). Times are clamped to >= 0 so a large backwards nudge
 * can never produce negative cue stamps that break VTT parsers.
 *
 * Used to align translated (non-English) captions whose timings were
 * inherited from the English source VTT but drifted from the video.
 */
export function shiftCues(cues: VttCue[], delta: number): VttCue[] {
  if (!delta) return cues;
  return cues.map((c) => ({
    ...c,
    start: Math.max(0, c.start + delta),
    end: Math.max(0, c.end + delta),
  }));
}

export function toVtt(cues: VttCue[]): string {
  const head = "WEBVTT\n\n";
  return (
    head +
    cues
      .map(
        (c) =>
          `${c.id}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}\n`,
      )
      .join("\n")
  );
}

/** Detect+normalize any subtitle text to valid VTT. */
export function normalizeToVtt(raw: string): string {
  const cues = parseVtt(raw);
  return toVtt(cues);
}
