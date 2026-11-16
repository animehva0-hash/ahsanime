import { fetchSubtitleCues, SubtitleFetchError } from "@/lib/stream/fetch-subtitle";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/stream/subtitle?url=<encoded>
 * Loads the provider's English VTT (or SRT/ASS) and always serves a clean,
 * normalized `text/vtt` response for use in a <track> element.
 */
export async function GET(req: Request) {
  const rl = rateLimit(`sub:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) {
    return Response.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }
  const url = new URL(req.url).searchParams.get("url") ?? "";
  try {
    const { vtt } = await fetchSubtitleCues(decodeURIComponent(url));
    return new Response(vtt, {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    const status = e instanceof SubtitleFetchError ? e.status : 500;
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "subtitle fetch failed" },
      { status },
    );
  }
}
