/**
 * Streaming provider: MegaPlay (embed).
 *
 * Modes (all verified live):
 *   sub      → soft-sub embed   https://megaplay.buzz/stream/ani/{anilistId}/{ep}/sub
 *   hardsub  → burnt-in subs    https://megaplay.buzz/stream/ani/{anilistId}/{ep}/hardsub
 *   dub      → English dub      https://megaplay.buzz/stream/ani/{anilistId}/{ep}/dub
 */

export type PlayerMode = "sub" | "hardsub" | "dub";

export const PLAYER_MODES: { id: PlayerMode; label: string; hint: string }[] = [
  { id: "sub", label: "SUB", hint: "Soft subtitles" },
  { id: "hardsub", label: "Hard Sub", hint: "Burnt-in subtitles" },
  { id: "dub", label: "DUB", hint: "English voiceover" },
];

export function megaPlayUrl(anilistId: number, episode: number, mode: PlayerMode): string {
  return `https://megaplay.buzz/stream/ani/${anilistId}/${episode}/${mode}`;
}

export function isSubtitleMode(mode: PlayerMode) {
  return mode === "sub";
}
