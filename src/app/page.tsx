import { getHomeData } from "@/lib/anilist";
import Spotlight from "@/components/spotlight";
import Row from "@/components/row";
import ContinueWatching from "@/components/continue-watching";
import HomeClientFallback from "@/components/home-client-fallback";
import { seasonLabel } from "@/lib/utils";

export const revalidate = 1800;

export default async function Home() {
  try {
    const data = await getHomeData();

    return (
      <div className="shell">
        <div className="pt-3 sm:pt-5">
          <Spotlight items={data.trending} />
        </div>

        <ContinueWatching />

        <Row title="Trending Now" items={data.trending} href="/discover/trending" />
        <Row title="Latest Updates" items={data.latestUpdated} href="/discover/updated" />
        <Row
          title={`Popular — ${seasonLabel(data.season, data.seasonYear)}`}
          items={data.seasonNow}
          href="/discover/ongoing"
        />
        <Row title="Coming Soon" items={data.upcoming} href="/discover/upcoming" />
        <Row title="All Time Legends" items={data.topAllTime} href="/discover/popular" ranked />

        <div className="h-10" />
      </div>
    );
  } catch {
    // Server quota over (single server IP) and nothing cached: DON'T show a
    // dead page. The fallback fetches directly from the VISITOR'S browser —
    // their own IP, their own quota (MangaYomi model: har device apni IP).
    return <HomeClientFallback />;
  }
}
