export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function scoreLabel(score: number | null | undefined) {
  if (!score) return null;
  return (score / 10).toFixed(1);
}

export function statusLabel(status: string | null | undefined) {
  switch (status) {
    case "RELEASING": return "Airing";
    case "FINISHED": return "Finished";
    case "NOT_YET_RELEASED": return "Coming Soon";
    case "CANCELLED": return "Cancelled";
    case "HIATUS": return "Hiatus";
    default: return "Unknown";
  }
}

export function formatLabel(format: string | null | undefined) {
  if (!format) return "Unknown";
  if (format === "TV_SHORT") return "TV Short";
  return format.replace(/_/g, " ");
}

/** Strip AniList's pseudo-markdown / residual tags from descriptions. */
export function cleanDescription(desc: string | null | undefined, max = 0): string {
  if (!desc) return "";
  let text = desc
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<i>([\s\S]*?)<\/i>/gi, "$1")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/~![\s\S]*?!~/g, "[spoiler]")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
  if (max > 0 && text.length > max) {
    text = text.slice(0, max).replace(/\s+\S*$/, "") + "…";
  }
  return text;
}

export function airingCountdown(
  nextAiring: { airingAt: number; episode: number } | null | undefined,
): string | null {
  if (!nextAiring) return null;
  const diff = nextAiring.airingAt * 1000 - Date.now();
  if (diff <= 0) return "Airing now";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const min = Math.floor((diff % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${min}m`);
  return `EP ${nextAiring.episode} in ${parts.join(" ")}`;
}

export function dateLabel(d: { year: number | null; month: number | null; day: number | null } | null | undefined) {
  if (!d?.year) return "TBA";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = d.month ? months[d.month - 1] : null;
  return m ? `${m} ${d.day ?? ""} ${d.year}`.replace("  ", " ") : `${d.year}`;
}

export function seasonLabel(season: string | null | undefined, year: number | null | undefined) {
  if (!season) return year ? `${year}` : "TBA";
  return `${season.charAt(0)}${season.slice(1).toLowerCase()} ${year ?? ""}`.trim();
}

export function compactNumber(n: number | null | undefined) {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
