import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import { searchMedia } from "@/lib/anilist";
import InfiniteGrid from "@/components/infinite-grid";
import ListClientFallback from "@/components/list-client-fallback";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  if (query.length < 2) {
    return (
      <div className="shell">
        <PageHeader kicker="Search" title="Find your next obsession" blurb="Type at least 2 characters in the search bar above." />
        <div className="flex h-64 flex-col items-center justify-center text-zinc-600">
          <SearchX className="h-10 w-10" />
          <p className="mt-3 text-sm">Try “One Piece”, “Frieren” or “Kaiju No. 8”…</p>
        </div>
      </div>
    );
  }

  let media: Awaited<ReturnType<typeof searchMedia>>["media"] = [];
  let hasNext = false;
  let total: number | null = null;
  let serverFailed = false;
  try {
    const res = await searchMedia({
      search: query,
      sort: ["SEARCH_MATCH", "POPULARITY_DESC"],
      page: 1,
      perPage: 24,
      ttl: 300,
    });
    media = res.media;
    hasNext = Boolean(res.pageInfo?.hasNextPage);
    total = res.pageInfo?.total ?? null;
  } catch {
    // Server quota over — the fallback below retries from the visitor's
    // browser (their own IP/quota) instead of showing "no results".
    serverFailed = true;
  }

  return (
    <div className="shell">
      <PageHeader kicker="Search results" title={`“${query}”`} count={total} />
      {media.length === 0 && serverFailed ? (
        <ListClientFallback
          params={{ search: query, sort: ["SEARCH_MATCH", "POPULARITY_DESC"] }}
          queryKey={{ search: query }}
        />
      ) : media.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center text-zinc-600">
          <SearchX className="h-10 w-10" />
          <p className="mt-3 text-sm">
            No anime found for “{query}”. Check the spelling or try the Romaji title.
          </p>
        </div>
      ) : (
        <InfiniteGrid initial={media} initiallyHasNext={hasNext} query={{ search: query }} />
      )}
      <div className="h-12" />
    </div>
  );
}
