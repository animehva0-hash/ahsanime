import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure-schema";
import { streamStats } from "@/db/schema";

export const dynamic = "force-dynamic";

async function getStats(animeId: number, episode: number) {
  await ensureSchema();
  const row = await db
    .select()
    .from(streamStats)
    .where(eq(streamStats.animeId, animeId))
    .limit(1);
  return row[0] ?? null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ animeId: string; episode: string }> },
) {
  const { animeId, episode } = await params;
  const aId = Number(animeId);
  const ep = Number(episode);
  if (!aId || !ep) return Response.json({ views: 0 }, { status: 400 });
  try {
    const row = await getStats(aId, ep);
    return Response.json({ views: row?.views ?? 0 });
  } catch {
    return Response.json({ views: 0 }, { status: 200 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ animeId: string; episode: string }> },
) {
  const { animeId, episode } = await params;
  const aId = Number(animeId);
  const ep = Number(episode);
  if (!aId || !ep) return Response.json({ ok: false }, { status: 400 });

  try {
    await ensureSchema();
    const existing = await getStats(aId, ep);
    if (existing) {
      await db
        .update(streamStats)
        .set({ views: existing.views + 1, updatedAt: new Date() })
        .where(eq(streamStats.animeId, aId));
    } else {
      await db.insert(streamStats).values({
        animeId: aId,
        episode: ep,
        views: 1,
        updatedAt: new Date(),
      });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
