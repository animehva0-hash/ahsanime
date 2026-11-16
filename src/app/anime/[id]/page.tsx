import type { Metadata } from "next";
import Link from "next/link";
import {
  Calendar,
  Clock,
  Film,
  FlaskConical,
  Globe,
  Heart,
  Layers,
  Link2,
  MonitorPlay,
  Play,
  Star,
  TrendingUp,
} from "lucide-react";
import { episodeTotal, getMediaDetail, getMediaMeta, type MediaCard } from "@/lib/anilist";
import {
  cleanDescription,
  cn,
  compactNumber,
  dateLabel,
  formatLabel,
  scoreLabel,
  seasonLabel,
  statusLabel,
} from "@/lib/utils";
import TitleText from "@/components/title-text";
import Description from "@/components/description";
import EpisodeGrid from "@/components/episode-grid";
import AiringCountdown from "@/components/airing-countdown";
import AnimeImage from "@/components/anime-image";
import DetailClientFallback from "@/components/detail-client-fallback";
import Row from "@/components/row";

// ISR: pages are cached and served instantly; background revalidation keeps
// episode counts / airing info fresh without making every visitor wait.
export const revalidate = 900;

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    // Light query — a title/description never needs the heavy detail body.
    const media = await getMediaMeta(Number(id));
    if (!media) return { title: "Anime" };
    return {
      title: media.title.english || media.title.romaji || "Anime",
      description: cleanDescription(media.description, 160),
    };
  } catch {
    return { title: "Anime" };
  }
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-1.5 truncate text-sm font-semibold text-zinc-200">{value}</p>
    </div>
  );
}

function RelationCard({ media, type }: { media: MediaCard; type: string | null }) {
  return (
    <Link
      href={`/anime/${media.id}`}
      className="group flex w-[300px] shrink-0 items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-2 transition-all hover:border-[#ff8a00]/40 hover:bg-white/[0.06]"
    >
      <AnimeImage
        sources={[media.coverImage?.extraLarge, media.coverImage?.large]}
        alt={media.title.english ?? media.title.romaji ?? ""}
        className="h-16 w-12 shrink-0 rounded-lg object-cover"
      />
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#ffb86b]">
          {(type ?? "Related").replace(/_/g, " ")}
        </p>
        <TitleText
          romaji={media.title.romaji}
          english={media.title.english}
          as="span"
          className="mt-1 line-clamp-2 block text-xs font-semibold text-zinc-200 group-hover:text-white"
        />
        <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">
          {formatLabel(media.format)} • {media.seasonYear ?? "TBA"}
        </p>
      </div>
    </Link>
  );
}

export default async function AnimePage({ params }: PageProps) {
  const { id } = await params;
  const media = await getMediaDetail(Number(id)).catch(() => null);
  // Server quota over → visitor's browser retries with THEIR OWN IP/quota
  // (MangaYomi model) instead of a 404.
  if (!media) return <DetailClientFallback id={Number(id)} />;

  const total = episodeTotal(media);
  const score = scoreLabel(media.averageScore);
  const color = media.coverImage?.color ?? "#ff8a00";
  // Same artwork the list card used → already cached by the browser.
  const coverArt = media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;
  // Episode 1 is playable whenever anything has aired.
  const watchHref =
    media.status === "NOT_YET_RELEASED" && total === 0 ? null : `/watch/${media.id}/1`;

  const recs =
    media.recommendations?.nodes
      .map((n) => n.mediaRecommendation)
      .filter((m): m is MediaCard => !!m) ?? [];

  return (
    <div className="animate-fade-in">
      {/* Backdrop — reuses the poster art (already in the browser cache from
          the card you tapped) so the page paints instantly and the artwork
          stays consistent with the list you came from. */}
      <div className="relative h-[38svh] min-h-[220px] overflow-hidden sm:h-[320px] lg:h-[400px]">
        {coverArt ? (
          <>
            <AnimeImage
              sources={[coverArt, media.bannerImage]}
              alt=""
              eager
              className="h-full w-full scale-110 object-cover object-top blur-[2px] sm:blur-0"
            />
            {/* Blend the poster into the page so text stays readable. */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#07070d] via-[#07070d]/55 to-[#07070d]/25" />
          </>
        ) : (
          <div
            className="h-full w-full"
            style={{ background: `linear-gradient(135deg, ${color}44, #0d0d18 60%)` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07070d] via-[#07070d]/40 to-transparent" />
        <div
          className="absolute inset-0 opacity-40"
          style={{ background: `radial-gradient(800px 300px at 20% 100%, ${color}33, transparent 60%)` }}
        />
      </div>

      <div className="shell">
        {/* Header */}
        <div className="-mt-20 flex flex-col gap-5 sm:-mt-24 md:-mt-28 md:flex-row md:gap-8">
          <div className="shrink-0">
            <AnimeImage
              sources={[coverArt, media.bannerImage]}
              alt={media.title.english ?? media.title.romaji ?? ""}
              eager
              className="w-40 rounded-2xl border border-white/15 object-cover shadow-2xl sm:w-52 md:w-56"
              style={{ boxShadow: `0 25px 60px -15px ${color}55` }}
            />
          </div>

          <div className="min-w-0 flex-1 md:pt-28">
            {media.title.native && (
              <p className="mb-1 text-xs tracking-[0.25em] text-zinc-500">{media.title.native}</p>
            )}
            <TitleText
              romaji={media.title.romaji}
              english={media.title.english}
              className="font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"
            />

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              {score && (
                <span className="flex items-center gap-1.5 rounded-full bg-amber-400/10 px-3 py-1.5 font-bold text-amber-300">
                  <Star className="h-3.5 w-3.5 fill-amber-300" /> {score}
                </span>
              )}
              <span
                className={cn(
                  "rounded-full px-3 py-1.5 font-semibold",
                  media.status === "RELEASING"
                    ? "bg-emerald-400/10 text-emerald-300"
                    : media.status === "NOT_YET_RELEASED"
                      ? "bg-sky-400/10 text-sky-300"
                      : "bg-white/10 text-zinc-300",
                )}
              >
                {statusLabel(media.status)}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1.5 font-semibold text-zinc-300">
                {formatLabel(media.format)}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-zinc-300">
                <Layers className="h-3 w-3" />
                {media.status === "RELEASING" && media.nextAiringEpisode
                  ? `EP ${media.nextAiringEpisode.episode - 1} aired`
                  : total
                    ? `${total} episodes`
                    : "Episodes TBA"}
              </span>
              {media.duration ? (
                <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-zinc-300">
                  <Clock className="h-3 w-3" /> {media.duration} min
                </span>
              ) : null}
              <AiringCountdown
                airingAt={media.nextAiringEpisode ? media.nextAiringEpisode.airingAt : null}
                episode={media.nextAiringEpisode ? media.nextAiringEpisode.episode : null}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(media.genres ?? []).map((g) => (
                <Link
                  key={g}
                  href={`/genre/${encodeURIComponent(g)}`}
                  className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:border-[#ff8a00]/50 hover:text-[#ffb86b]"
                >
                  {g}
                </Link>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {watchHref && (
                <Link
                  href={watchHref}
                  className="group flex items-center gap-2.5 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-[#ff3d5a]/30 transition-transform hover:scale-[1.03] active:scale-95"
                >
                  <Play className="h-4 w-4 fill-white transition-transform group-hover:scale-125" />
                  {media.format === "MOVIE" ? "Watch Movie" : "Start Watching"}
                </Link>
              )}
              {media.trailer?.site === "youtube" && media.trailer.id && (
                <a
                  href={`https://www.youtube.com/watch?v=${media.trailer.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="glass flex items-center gap-2 rounded-full border border-white/15 px-5 py-3.5 text-sm font-semibold text-zinc-200 transition-all hover:border-red-400/50 hover:text-red-300"
                >
                  <MonitorPlay className="h-4 w-4" /> Trailer
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="mt-8 grid gap-8 sm:mt-12 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0">
            <h2 className="font-display mb-4 text-xl font-bold tracking-tight text-white">Synopsis</h2>
            <Description text={cleanDescription(media.description)} />

            {total > 0 && media.status !== "NOT_YET_RELEASED" && (
              <div className="mt-12">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold tracking-tight text-white">
                    Episodes
                  </h2>
                  <span className="text-xs text-zinc-500">
                    {total} available
                    {media.status === "RELEASING" && media.episodes
                      ? ` of ${media.episodes}`
                      : ""}
                  </span>
                </div>
                <EpisodeGrid animeId={media.id} total={total} />
              </div>
            )}

            {(media.relations?.edges?.length ?? 0) > 0 && (
              <div className="mt-12">
                <h2 className="font-display mb-4 text-xl font-bold tracking-tight text-white">
                  Relations
                </h2>
                <div className="row-track no-scrollbar flex overflow-x-auto pb-2">
                  {media.relations!.edges.map((e, i) => (
                    <RelationCard key={`${e.node.id}-${i}`} media={e.node} type={e.relationType} />
                  ))}
                </div>
              </div>
            )}

            {(media.characters?.edges?.length ?? 0) > 0 && (
              <div className="mt-12">
                <h2 className="font-display mb-4 text-xl font-bold tracking-tight text-white">
                  Characters
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {media.characters!.edges.slice(0, 8).map((edge, i) => (
                    <div
                      key={`${edge.node.name.full}-${i}`}
                      className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-2.5"
                    >
                      <AnimeImage
                        src={edge.node.image?.medium}
                        alt={edge.node.name.full ?? ""}
                        className="h-11 w-11 shrink-0 rounded-full border border-white/10 object-cover"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-zinc-200">
                          {edge.node.name.full}
                        </p>
                        <p className="truncate text-[10px] text-zinc-500">
                          {edge.role === "MAIN" ? "Main" : "Supporting"}
                          {edge.voiceActors[0]?.name.full
                            ? ` • ${edge.voiceActors[0].name.full}`
                            : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar stats */}
          <aside className="space-y-3">
            <h3 className="font-display mb-4 text-lg font-bold tracking-tight text-white">Details</h3>
            <Stat icon={TrendingUp} label="Popularity" value={media.popularity ? `#${compactNumber(media.popularity)} users` : null} />
            <Stat icon={Heart} label="Favourites" value={media.favourites ? compactNumber(media.favourites) : null} />
            <Stat icon={Calendar} label="Aired" value={`${dateLabel(media.startDate)} → ${dateLabel(media.endDate) === "TBA" && media.status === "RELEASING" ? "…" : dateLabel(media.endDate)}`} />
            <Stat icon={Film} label="Season" value={seasonLabel(media.season, media.seasonYear)} />
            <Stat icon={Globe} label="Origin" value={media.countryOfOrigin ?? null} />
            <Stat icon={Link2} label="Source" value={media.source ? formatLabel(media.source) : null} />
            <Stat icon={FlaskConical} label="Studio" value={media.studios?.nodes?.[0]?.name ?? null} />
            {media.nextAiringEpisode && (
              <Stat
                icon={Clock}
                label="Next Episode"
                value={`EP ${media.nextAiringEpisode.episode} — ${new Date(
                  media.nextAiringEpisode.airingAt * 1000,
                ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
              />
            )}
            {Boolean(media.synonyms?.length) && (
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Synonyms
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  {(media.synonyms ?? []).slice(0, 4).join(" • ")}
                </p>
              </div>
            )}
            {Boolean(media.tags?.length) && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(media.tags ?? []).slice(0, 10).map((t) => (
                  <span
                    key={t.name}
                    className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-zinc-500"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </aside>
        </div>

        {recs.length > 0 && (
          <Row title="You Might Also Like" items={recs.slice(0, 12)} />
        )}
        <div className="h-12" />
      </div>
    </div>
  );
}
