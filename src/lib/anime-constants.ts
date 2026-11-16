/**
 * Client-safe constants & types shared by the UI.
 *
 * Split out of `src/lib/anilist.ts` so that client components never pull the
 * AniList GraphQL client (which now depends on the Postgres fallback cache and
 * therefore on Node-only modules like `pg`).
 */

export type DateObj = { year: number | null; month: number | null; day: number | null };

export type MediaCard = {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  coverImage: { extraLarge: string | null; large: string | null; color: string | null };
  bannerImage: string | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  duration: number | null;
  averageScore: number | null;
  popularity: number | null;
  seasonYear: number | null;
  season: string | null;
  genres: string[] | null;
  description: string | null;
  nextAiringEpisode: { airingAt: number; episode: number; timeUntilAiring: number } | null;
  trending: number | null;
  startDate: DateObj | null;
};

export const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror",
  "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];

export const FORMATS = [
  { value: "TV", label: "TV" },
  { value: "MOVIE", label: "Movie" },
  { value: "OVA", label: "OVA" },
  { value: "ONA", label: "ONA" },
  { value: "SPECIAL", label: "Special" },
  { value: "MUSIC", label: "Music" },
];

export type DiscoverKind =
  | "trending" | "updated" | "added" | "popular" | "upcoming" | "ongoing" | "complete";

export const DISCOVER_CONFIG: Record<
  DiscoverKind,
  { title: string; status?: string; sort: string[]; blurb: string }
> = {
  trending: { title: "Trending Anime", sort: ["TRENDING_DESC"], blurb: "What the community is watching right now — trending across all of AniList." },
  updated: { title: "Recently Updated", status: "RELEASING", sort: ["UPDATED_AT_DESC"], blurb: "Anime with the latest airing activity." },
  added: { title: "Recently Added", sort: ["ID_DESC"], blurb: "Fresh entries added to the AniList database." },
  popular: { title: "All Time Popular", sort: ["POPULARITY_DESC"], blurb: "The most tracked anime across the community." },
  upcoming: { title: "Upcoming", status: "NOT_YET_RELEASED", sort: ["POPULARITY_DESC"], blurb: "Announced anime arriving soon." },
  ongoing: { title: "Currently Airing", status: "RELEASING", sort: ["POPULARITY_DESC"], blurb: "Ongoing series airing right now." },
  complete: { title: "Completed", status: "FINISHED", sort: ["POPULARITY_DESC"], blurb: "Finished series, ready for a full binge." },
};

/** AIRED episodes only — `nextAiringEpisode` wins over the planned total. */
export function episodeTotal(
  m: Pick<MediaCard, "episodes" | "nextAiringEpisode" | "status">,
): number {
  if (m.nextAiringEpisode) {
    const aired = Math.max(0, m.nextAiringEpisode.episode - 1);
    return m.episodes && m.episodes > 0 ? Math.min(aired, m.episodes) : aired;
  }
  if (m.status === "NOT_YET_RELEASED") return 0;
  if (m.episodes && m.episodes > 0) return m.episodes;
  return 0;
}

export function pickTitle(
  title: MediaCard["title"],
  lang: "en" | "jp",
): string {
  return (lang === "jp"
    ? title.romaji || title.english
    : title.english || title.romaji) ?? "Unknown";
}
