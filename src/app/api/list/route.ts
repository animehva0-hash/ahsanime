import { DISCOVER_CONFIG, searchMedia, type DiscoverKind, type ListParams } from "@/lib/anilist";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Infinite-scroll can fire bursts — cap per IP to protect shared quota.
  const rl = rateLimit(`list:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return Response.json(
      { results: [], hasNext: true, error: "Too many requests — slow down." },
      { status: 429, headers: { "Retry-After": "5" } },
    );
  }
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const kind = sp.get("kind") as DiscoverKind | null;

  const base: ListParams = {
    page,
    perPage: 24,
    ttl: 600,
  };

  if (kind && DISCOVER_CONFIG[kind]) {
    const cfg = DISCOVER_CONFIG[kind];
    base.status = cfg.status;
    base.sort = cfg.sort;
  } else {
    const search = sp.get("search") ?? undefined;
    const genre = sp.get("genre") ?? undefined;
    const format = sp.get("format") ?? undefined;
    if (search) base.search = search;
    if (genre) base.genre = genre;
    if (format) base.format = format.toUpperCase();
    base.sort = search ? ["SEARCH_MATCH", "POPULARITY_DESC"] : ["POPULARITY_DESC"];
  }

  try {
    const { media, pageInfo } = await searchMedia(base);
    return Response.json({
      results: media,
      pageInfo,
      hasNext: Boolean(pageInfo?.hasNextPage),
    });
  } catch (e) {
    return Response.json(
      { results: [], hasNext: false, error: e instanceof Error ? e.message : "error" },
      { status: 200 },
    );
  }
}
