import { cookies } from "next/headers";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure-schema";
import { activity } from "@/db/schema";

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
      .from(activity)
      .orderBy(desc(activity.watchedAt))
      .limit(40);
    const items = rows.map((r) => ({
      uid: r.uid,
      animeId: r.animeId,
      episode: r.episode,
      titleRomaji: r.titleRomaji,
      titleEnglish: r.titleEnglish,
      cover: r.cover,
      mode: r.mode,
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
  const mode = body?.mode ?? "sub";
  if (!animeId) return Response.json({ ok: false }, { status: 400 });

  try {
    await db.insert(activity).values({
      uid,
      animeId,
      episode,
      titleRomaji: body.titleRomaji ?? null,
      titleEnglish: body.titleEnglish ?? null,
      cover: body.cover ?? null,
      mode,
      watchedAt: new Date(),
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
