import { cookies } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure-schema";
import { watchHistory } from "@/db/schema";

export const dynamic = "force-dynamic";

async function getUid() {
  await ensureSchema();
  const store = await cookies();
  return store.get("na_uid")?.value ?? null;
}

export async function GET() {
  const uid = await getUid();
  if (!uid) return Response.json({ items: [] });
  try {
    const rows = await db
      .select()
      .from(watchHistory)
      .where(eq(watchHistory.uid, uid))
      .orderBy(desc(watchHistory.watchedAt))
      .limit(200);
    // Table is unique on (uid, animeId) so rows are already distinct by anime.
    const items = rows.slice(0, 24).map((r) => ({
      animeId: r.animeId,
      episode: r.episode,
      titleRomaji: r.titleRomaji,
      titleEnglish: r.titleEnglish,
      cover: r.cover,
      color: r.color,
      watchedAt: r.watchedAt.toISOString(),
    }));
    return Response.json({ items });
  } catch {
    return Response.json({ items: [] }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const uid = await getUid();
  if (!uid) return Response.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const animeId = Number(body?.animeId);
  const episode = Math.max(1, Number(body?.episode) || 1);
  if (!animeId) return Response.json({ ok: false }, { status: 400 });

  const now = new Date();
  try {
    await db
      .insert(watchHistory)
      .values({
        uid,
        animeId,
        episode,
        titleRomaji: body.titleRomaji ?? null,
        titleEnglish: body.titleEnglish ?? null,
        cover: body.cover ?? null,
        color: body.color ?? null,
        watchedAt: now,
      })
      .onConflictDoUpdate({
        target: [watchHistory.uid, watchHistory.animeId],
        set: {
          episode,
          titleRomaji: body.titleRomaji ?? null,
          titleEnglish: body.titleEnglish ?? null,
          cover: body.cover ?? null,
          color: body.color ?? null,
          watchedAt: now,
        },
      });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const uid = await getUid();
  if (!uid) return Response.json({ ok: false }, { status: 401 });
  const animeId = Number(new URL(req.url).searchParams.get("animeId"));
  if (!animeId) return Response.json({ ok: false }, { status: 400 });
  try {
    await db
      .delete(watchHistory)
      .where(and(eq(watchHistory.uid, uid), eq(watchHistory.animeId, animeId)));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
