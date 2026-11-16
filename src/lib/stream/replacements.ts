/**
 * Post-processing rules applied to translated subtitle text.
 *
 * replacements_lines.txt  → full-line corrections ("lhs => rhs"; if any cue
 *                           line contains lhs, the whole line becomes rhs)
 * replacements_words.txt  → whole-word corrections (case-insensitive,
 *                           word-boundary matched)
 *
 * Files live in the project root and are cached in memory (hot-reload on
 * restart). Missing files are fine — rules become no-ops.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

type Rules = { lines: [string, string][]; words: RegExp[]; wordTo: string[] };

const g = globalThis as unknown as { __na_rules?: Rules };

function load(): Rules {
  const read = (file: string): [string, string][] => {
    try {
      const raw = readFileSync(path.join(process.cwd(), file), "utf8");
      const out: [string, string][] = [];
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.split(/\s*=>+\s*/);
        if (idx.length >= 2 && idx[0] && idx[1]) out.push([idx[0], idx.slice(1).join(" => ")]);
      }
      return out;
    } catch {
      return [];
    }
  };

  const lines = read("replacements_lines.txt");
  const wordPairs = read("replacements_words.txt");
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = wordPairs.map(([w]) => new RegExp(`(^|[\\s.,!?…—–-])(${escape(w)})(?=[\\s.,!?…—–-]|$)`, "gi"));
  const wordTo = wordPairs.map(([, r]) => r);

  return { lines, words, wordTo };
}

export function getRules(): Rules {
  return (g.__na_rules ??= load());
}

/** Apply line replacements first, then whole-word replacements. */
export function applyReplacements(text: string): string {
  const rules = getRules();
  let out = text;

  for (const [lhs, rhs] of rules.lines) {
    const needle = lhs.toLowerCase();
    out = out
      .split("\n")
      .map((line) => (line.trim().toLowerCase().includes(needle) ? rhs : line))
      .join("\n");
  }

  rules.words.forEach((re, i) => {
    out = out.replace(re, `$1${rules.wordTo[i]}`);
  });

  return out;
}

/**
 * Last-resort safety net: strip any English words that survived Gemini's
 * translation. Removes standalone [a-zA-Z]+ words bounded by whitespace or
 * line edges, then collapses the whitespace they leave behind. Numbers and
 * the target language's script are untouched.
 */
export function stripRemainingEnglish(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        // Remove standalone English words bounded by whitespace/line edges,
        // optionally followed by punctuation.
        .replace(/(?:^|\s)[a-zA-Z]+(?=[\s.,!?…—–:;-]|$)/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join("\n");
}