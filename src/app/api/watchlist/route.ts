import { cookies } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure-schema";
import { watchlist } from "@/db/schema";

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
      .from(watchlist)
      .where(eq(watchlist.uid, uid))
      .orderBy(desc(watchlist.createdAt))
      .limit(500);
    return Response.json({ items: rows });
  } catch {
    return Response.json({ items: [] }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const uid = await getUid();
  if (!uid) return Response.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const animeId = Number(body?.animeId);
  if (!animeId) return Response.json({ ok: false }, { status: 400 });

  const values = {
    uid,
    animeId,
    titleRomaji: body.titleRomaji ?? null,
    titleEnglish: body.titleEnglish ?? null,
    cover: body.cover ?? null,
    color: body.color ?? null,
    format: body.format ?? null,
    status: body.status ?? null,
    score: typeof body.score === "number" ? Math.round(body.score) : null,
    episode: typeof body.episode === "number" ? body.episode : null,
  };

  try {
    await db
      .insert(watchlist)
      .values(values)
      .onConflictDoUpdate({
        target: [watchlist.uid, watchlist.animeId],
        set: {
          titleRomaji: values.titleRomaji,
          titleEnglish: values.titleEnglish,
          cover: values.cover,
          color: values.color,
          format: values.format,
          status: values.status,
          score: values.score,
          episode: values.episode,
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
      .delete(watchlist)
      .where(and(eq(watchlist.uid, uid), eq(watchlist.animeId, animeId)));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
