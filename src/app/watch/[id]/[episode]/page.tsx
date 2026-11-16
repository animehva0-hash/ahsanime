import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { episodeTotal, getMediaDetail } from "@/lib/anilist";
import { formatLabel } from "@/lib/utils";
import Player from "@/components/player";
import EpisodeGrid from "@/components/episode-grid";
import AnimeImage from "@/components/anime-image";
import WatchClientFallback from "@/components/watch-client-fallback";
import TitleText from "@/components/title-text";
import ActivityFeed from "@/components/activity-feed";
import StreamStats from "@/components/stream-stats";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure-schema";
import { activity, streamStats } from "@/db/schema";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string; episode: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id, episode } = await params;
  try {
    const media = await getMediaDetail(Number(id));
    const name = media?.title.english || media?.title.romaji || "Anime";
    return { title: `${name} — Episode ${episode}` };
  } catch {
    return { title: `Episode ${episode}` };
  }
}

export default async function WatchPage({ params }: PageProps) {
  const { id, episode } = await params;
  const animeId = Number(id);
  const ep = Number(episode);
  if (!Number.isFinite(animeId) || !Number.isFinite(ep) || ep < 1) notFound();

  const media = await getMediaDetail(animeId).catch(() => null);
  // Server quota over → visitor's browser retries with THEIR OWN IP/quota.
  if (!media) return <WatchClientFallback animeId={animeId} episode={ep} />;

  const total = episodeTotal(media);
  const isMovie = media.format === "MOVIE";
  if (total > 0 && ep > total) notFound();
  if (isMovie && ep !== 1) notFound();

  const color = media.coverImage?.color ?? "#ff8a00";
  const cover = media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;

  // Stream stats increment + activity log (best-effort, never blocks the page).
  const store = await cookies();
  const uid = store.get("na_uid")?.value;
  if (uid) {
    (async () => {
      try {
        await ensureSchema();
        const existing = await db
          .select()
          .from(streamStats)
          .where(eq(streamStats.animeId, animeId))
          .limit(1);
        if (existing[0]) {
          await db
            .update(streamStats)
            .set({ views: existing[0].views + 1, updatedAt: new Date() })
            .where(eq(streamStats.animeId, animeId));
        } else {
          await db.insert(streamStats).values({
            animeId,
            episode: ep,
            views: 1,
            updatedAt: new Date(),
          });
        }
        await db.insert(activity).values({
          uid,
          animeId,
          episode: ep,
          titleRomaji: media.title.romaji ?? null,
          titleEnglish: media.title.english ?? null,
          cover: cover ?? null,
          mode: "sub",
          watchedAt: new Date(),
        });
      } catch {
        /* best-effort: never break the page */
      }
    })();
  }

  return (
    <div className="shell py-6 animate-fade-in">
      {/* Topbar */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Link
          href={`/anime/${media.id}`}
          className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-zinc-300 transition-all hover:border-[#ff8a00]/50 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back
        </Link>
        <div className="min-w-0">
          <TitleText
            romaji={media.title.romaji}
            english={media.title.english}
            as="h1"
            className="font-display truncate text-lg font-bold tracking-tight text-white sm:text-xl"
          />
          <p className="mt-0.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">
            <Clapperboard className="h-3 w-3" />
            {formatLabel(media.format)} • {isMovie ? "Movie" : `Episode ${ep}`}
            {total > 0 && !isMovie ? ` of ${total}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_300px] lg:gap-6 xl:grid-cols-[1fr_340px]">
        <Player
          key={`${animeId}-${ep}`}
          anilistId={media.id}
          malId={media.idMal}
          episode={ep}
          epTotal={total}
          color={color}
          titleRomaji={media.title.romaji}
          titleEnglish={media.title.english}
          cover={cover}
        />

        {/* Episode rail */}
        <aside className="min-w-0">
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="mb-4 flex items-center gap-3">
              <AnimeImage
                sources={[cover, media.bannerImage]}
                alt={media.title.english ?? media.title.romaji ?? ""}
                className="h-16 w-12 rounded-lg object-cover"
                style={{ boxShadow: `0 8px 24px -8px ${color}66` }}
              />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffb86b]">
                  Now Playing
                </p>
                <p className="mt-1 text-sm font-bold text-white">
                  {isMovie ? "Movie" : `EP ${ep}`}
                </p>
                <StreamStats animeId={animeId} episode={ep} />
              </div>
            </div>
            {total > 1 && (
              <EpisodeGrid animeId={media.id} total={total} current={ep} compact />
            )}
            <ActivityFeed />
          </div>
        </aside>
      </div>
      <div className="h-10" />
    </div>
  );
}
