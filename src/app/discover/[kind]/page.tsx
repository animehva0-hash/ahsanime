import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DISCOVER_CONFIG, searchMedia, type DiscoverKind } from "@/lib/anilist";
import InfiniteGrid from "@/components/infinite-grid";
import ListClientFallback from "@/components/list-client-fallback";
import PageHeader from "@/components/page-header";

export const revalidate = 1800;

type Props = { params: Promise<{ kind: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind } = await params;
  const cfg = DISCOVER_CONFIG[kind as DiscoverKind];
  return { title: cfg ? cfg.title : "Discover" };
}

export default async function DiscoverPage({ params }: Props) {
  const { kind } = await params;
  const cfg = DISCOVER_CONFIG[kind as DiscoverKind];
  if (!cfg) notFound();

  let media: Awaited<ReturnType<typeof searchMedia>>["media"] = [];
  let hasNext = false;
  let total: number | null = null;
  try {
    const res = await searchMedia({
      status: cfg.status,
      sort: cfg.sort,
      page: 1,
      perPage: 24,
      ttl: 900,
    });
    media = res.media;
    hasNext = Boolean(res.pageInfo?.hasNextPage);
    total = res.pageInfo?.total ?? null;
  } catch {
    /* grid will be empty; rate limited fallback */
  }

  return (
    <div className="shell">
      <PageHeader kicker="Discover" title={cfg.title} blurb={cfg.blurb} count={total} />
      {media.length === 0 ? (
        <ListClientFallback
          params={{ status: cfg.status, sort: cfg.sort }}
          queryKey={{ kind }}
        />
      ) : (
        <InfiniteGrid
          initial={media}
          initiallyHasNext={hasNext}
          query={{ kind }}
        />
      )}
      <div className="h-12" />
    </div>
  );
}
