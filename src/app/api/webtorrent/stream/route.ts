/**
 * GET /api/webtorrent/stream?magnet=<urlencoded>&filename=<urlencoded>
 * Proxies HTTP Range video stream from the WebTorrent server to the browser.
 * The browser video element / hls.js can play this as progressive MP4.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const magnet = searchParams.get("magnet");
  const filename = searchParams.get("filename");
  if (!magnet || !filename) {
    return Response.json({ error: "Magnet and filename required" }, { status: 400 });
  }

  try {
    const WEBTORRENT_SERVER_URL =
      process.env.WEBTORRENT_SERVER_URL || "http://localhost:64622";

    const res = await fetch(
      `${WEBTORRENT_SERVER_URL}/streamfile/${encodeURIComponent(magnet)}/${encodeURIComponent(filename)}`,
      {
        headers: {
          Range: req.headers.get("range") ?? "",
          Accept: "video/mp4, */*",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!res.ok) {
      return new Response(null, { status: res.status });
    }

    // Forward range response headers
    const headers = new Headers();
    const contentRange = res.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Type", "video/mp4");
    const contentLength = res.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
