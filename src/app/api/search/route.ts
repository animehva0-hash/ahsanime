import { getSuggestions } from "@/lib/anilist";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ results: [] });
  // Autocomplete fires per keystroke — cap per IP so one fast typist (or a
  // bot) can't burn the shared 30/min AniList quota for everyone.
  const rl = rateLimit(`search:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return Response.json(
      { results: [], error: "Too many searches — slow down a moment." },
      { status: 429, headers: { "Retry-After": "5" } },
    );
  }
  try {
    const results = await getSuggestions(q);
    return Response.json({ results });
  } catch {
    return Response.json({ results: [] }, { status: 200 });
  }
}
