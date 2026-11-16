import type { MetadataRoute } from "next";

const SITE =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://indanime.co";

/** Static routes that always exist. */
const STATIC_ROUTES: { path: string; priority: number; freq: string }[] = [
  { path: "/", priority: 1.0, freq: "daily" },
  { path: "/discover/trending", priority: 0.9, freq: "hourly" },
  { path: "/discover/updated", priority: 0.9, freq: "hourly" },
  { path: "/discover/added", priority: 0.8, freq: "hourly" },
  { path: "/discover/popular", priority: 0.8, freq: "daily" },
  { path: "/discover/ongoing", priority: 0.8, freq: "hourly" },
  { path: "/discover/upcoming", priority: 0.7, freq: "daily" },
  { path: "/discover/complete", priority: 0.7, freq: "weekly" },
  { path: "/library", priority: 0.5, freq: "weekly" },
  { path: "/dmca", priority: 0.3, freq: "yearly" },
  { path: "/terms", priority: 0.3, freq: "yearly" },
  { path: "/contact", priority: 0.4, freq: "yearly" },
];

const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror",
  "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];

const TYPES = ["tv", "movie", "ova", "ona", "special", "music"];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [];

  for (const r of STATIC_ROUTES) {
    entries.push({
      url: `${SITE}${r.path}`,
      lastModified: now,
      changeFrequency: r.freq as MetadataRoute.Sitemap[number]["changeFrequency"],
      priority: r.priority,
    });
  }

  for (const g of GENRES) {
    entries.push({
      url: `${SITE}/genre/${encodeURIComponent(g)}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  for (const t of TYPES) {
    entries.push({
      url: `${SITE}/type/${t}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  return entries;
}
