/**
 * GET /api/webtorrent/metadata?magnet=<urlencoded magnet>
 * Returns file listing for a torrent from the WebTorrent server.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const magnet = searchParams.get("magnet");
  if (!magnet) {
    return Response.json({ error: "Magnet required" }, { status: 400 });
  }

  try {
    const WEBTORRENT_SERVER_URL =
      process.env.WEBTORRENT_SERVER_URL || "http://localhost:64622";

    const res = await fetch(
      `${WEBTORRENT_SERVER_URL}/metadata/${encodeURIComponent(magnet)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: text || "Failed to get metadata" }, { status: res.status });
    }

    const data = await res.json();
    return Response.json({ ok: true, ...data });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
