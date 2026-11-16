import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const watchlist = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    uid: text("uid").notNull(),
    animeId: integer("anime_id").notNull(),
    titleRomaji: text("title_romaji"),
    titleEnglish: text("title_english"),
    cover: text("cover"),
    color: text("color"),
    format: text("format"),
    status: text("status"),
    score: integer("score"),
    episode: integer("episode"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("watchlist_uid_anime_idx").on(t.uid, t.animeId),
    index("watchlist_uid_idx").on(t.uid),
  ],
);

export const watchHistory = pgTable(
  "watch_history",
  {
    id: serial("id").primaryKey(),
    uid: text("uid").notNull(),
    animeId: integer("anime_id").notNull(),
    episode: integer("episode").notNull(),
    titleRomaji: text("title_romaji"),
    titleEnglish: text("title_english"),
    cover: text("cover"),
    color: text("color"),
    watchedAt: timestamp("watched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("history_uid_anime_idx").on(t.uid, t.animeId),
    index("history_uid_idx").on(t.uid),
  ],
);

export type WatchlistRow = typeof watchlist.$inferSelect;
export type WatchHistoryRow = typeof watchHistory.$inferSelect;

/** Aggregate view count per anime + episode (stream stats). */
export const streamStats = pgTable(
  "stream_stats",
  {
    id: serial("id").primaryKey(),
    animeId: integer("anime_id").notNull(),
    episode: integer("episode").notNull(),
    views: integer("views").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("stream_stats_anime_ep_idx").on(t.animeId, t.episode),
    index("stream_stats_anime_idx").on(t.animeId),
  ],
);

/** Recent activity feed — who is watching what right now. */
export const activity = pgTable(
  "activity",
  {
    id: serial("id").primaryKey(),
    uid: text("uid").notNull(),
    animeId: integer("anime_id").notNull(),
    episode: integer("episode").notNull(),
    titleRomaji: text("title_romaji"),
    titleEnglish: text("title_english"),
    cover: text("cover"),
    mode: text("mode").notNull().default("sub"),
    watchedAt: timestamp("watched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("activity_watched_at_idx").on(t.watchedAt)],
);

export type StreamStatsRow = typeof streamStats.$inferSelect;
export type ActivityRow = typeof activity.$inferSelect;
