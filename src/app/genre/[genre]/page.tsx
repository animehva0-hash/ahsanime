import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GENRES, searchMedia } from "@/lib/anilist";
import InfiniteGrid from "@/components/infinite-grid";
import ListClientFallback from "@/components/list-client-fallback";
import PageHeader from "@/components/page-header";

export const revalidate = 1800;

type Props = { params: Promise<{ genre: string }> };

function normalizeGenre(raw: string) {
  const decoded = decodeURIComponent(raw).replace(/-/g, " ");
  return GENRES.find((g) => g.toLowerCase() === decoded.toLowerCase()) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { genre } = await params;
  const g = normalizeGenre(genre);
  return { title: g ? `${g} Anime` : "Genre" };
}

export default async function GenrePage({ params }: Props) {
  const { genre: raw } = await params;
  const genre = normalizeGenre(raw);
  if (!genre) notFound();

  let media: Awaited<ReturnType<typeof searchMedia>>["media"] = [];
  let hasNext = false;
  let total: number | null = null;
  try {
    const res = await searchMedia({ genre, sort: ["TRENDING_DESC"], page: 1, perPage: 24, ttl: 900 });
    media = res.media;
    hasNext = Boolean(res.pageInfo?.hasNextPage);
    total = res.pageInfo?.total ?? null;
  } catch {
    /* empty state below */
  }

  return (
    <div className="shell">
      <PageHeader
        kicker="Genre"
        title={genre}
        blurb={`Trending ${genre.toLowerCase()} anime, ranked by the community.`}
        count={total}
      />
      {media.length === 0 ? (
        <ListClientFallback params={{ genre, sort: ["TRENDING_DESC"] }} queryKey={{ genre }} />
      ) : (
        <InfiniteGrid initial={media} initiallyHasNext={hasNext} query={{ genre }} />
      )}
      <div className="h-12" />
    </div>
  );
}
