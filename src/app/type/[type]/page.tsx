import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FORMATS, searchMedia } from "@/lib/anilist";
import InfiniteGrid from "@/components/infinite-grid";
import ListClientFallback from "@/components/list-client-fallback";
import PageHeader from "@/components/page-header";

export const revalidate = 1800;

type Props = { params: Promise<{ type: string }> };

function normalizeFormat(raw: string) {
  return (
    FORMATS.find((f) => f.value.toLowerCase() === raw.toLowerCase() || f.label.toLowerCase() === raw.toLowerCase()) ??
    null
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  const f = normalizeFormat(type);
  return { title: f ? `${f.label} Anime` : "Type" };
}

export default async function TypePage({ params }: Props) {
  const { type } = await params;
  const format = normalizeFormat(type);
  if (!format) notFound();

  let media: Awaited<ReturnType<typeof searchMedia>>["media"] = [];
  let hasNext = false;
  let total: number | null = null;
  try {
    const res = await searchMedia({
      format: format.value,
      sort: ["POPULARITY_DESC"],
      page: 1,
      perPage: 24,
      ttl: 900,
    });
    media = res.media;
    hasNext = Boolean(res.pageInfo?.hasNextPage);
    total = res.pageInfo?.total ?? null;
  } catch {
    /* empty state */
  }

  return (
    <div className="shell">
      <PageHeader
        kicker="Type"
        title={`${format.label} Anime`}
        blurb={`The community's favourite anime in ${format.label} format.`}
        count={total}
      />
      {media.length === 0 ? (
        <ListClientFallback
          params={{ format: format.value, sort: ["POPULARITY_DESC"] }}
          queryKey={{ format: format.value }}
        />
      ) : (
        <InfiniteGrid
          initial={media}
          initiallyHasNext={hasNext}
          query={{ format: format.value }}
        />
      )}
      <div className="h-12" />
    </div>
  );
}
