/**
 * Auto-creates the database tables on first use.
 *
 * Runs once per process (idempotent, `CREATE TABLE IF NOT EXISTS`), so a fresh
 * deployment — local, Docker or Vercel + hosted Postgres — never needs a manual
 * migration step. Matches src/db/schema.ts exactly.
 */

import { sql } from "drizzle-orm";
import { db } from "./index";

const g = globalThis as unknown as { __na_schema_ready?: Promise<void> };

async function createTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS watchlist (
      id serial PRIMARY KEY,
      uid text NOT NULL,
      anime_id integer NOT NULL,
      title_romaji text,
      title_english text,
      cover text,
      color text,
      format text,
      status text,
      score integer,
      episode integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS episode integer`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS watchlist_uid_anime_idx ON watchlist (uid, anime_id)`,
  );
  await db.execute(sql`CREATE INDEX IF NOT EXISTS watchlist_uid_idx ON watchlist (uid)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS watch_history (
      id serial PRIMARY KEY,
      uid text NOT NULL,
      anime_id integer NOT NULL,
      episode integer NOT NULL,
      title_romaji text,
      title_english text,
      cover text,
      color text,
      watched_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE watch_history ADD COLUMN IF NOT EXISTS uid text`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS history_uid_anime_idx ON watch_history (uid, anime_id)`,
  );
  await db.execute(sql`CREATE INDEX IF NOT EXISTS history_uid_idx ON watch_history (uid)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stream_stats (
      id serial PRIMARY KEY,
      anime_id integer NOT NULL,
      episode integer NOT NULL,
      views integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS stream_stats_anime_ep_idx ON stream_stats (anime_id, episode)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS stream_stats_anime_idx ON stream_stats (anime_id)`,
  );

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS activity (
      id serial PRIMARY KEY,
      uid text NOT NULL,
      anime_id integer NOT NULL,
      episode integer NOT NULL,
      title_romaji text,
      title_english text,
      cover text,
      mode text NOT NULL DEFAULT 'sub',
      watched_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS activity_watched_at_idx ON activity (watched_at)`,
  );
}

/** Idempotent, cached across requests. Safe to await in any route. */
export function ensureSchema(): Promise<void> {
  if (!g.__na_schema_ready) {
    g.__na_schema_ready = createTables().catch((err) => {
      // Allow a later request to retry if the DB was briefly unavailable.
      g.__na_schema_ready = undefined;
      throw err;
    });
  }
  return g.__na_schema_ready;
}
