/**
 * POST /api/webtorrent/add
 * Body: { magnet: string }
 * Tells the WebTorrent server to start seeding a magnet link.
 * Returns { infoHash, files }.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { magnet } = body;
    if (!magnet) {
      return Response.json({ error: "Magnet required" }, { status: 400 });
    }

    const WEBTORRENT_SERVER_URL =
      process.env.WEBTORRENT_SERVER_URL || "http://localhost:64622";

    const res = await fetch(`${WEBTORRENT_SERVER_URL}/add/${encodeURIComponent(magnet)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: text || "Failed to add torrent" }, { status: res.status });
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
