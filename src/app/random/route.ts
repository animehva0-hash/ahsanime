import { redirect } from "next/navigation";
import { getRandomAnimeId } from "@/lib/anilist";

export const dynamic = "force-dynamic";

export async function GET() {
  let id: number | null = null;
  try {
    id = await getRandomAnimeId();
  } catch {
    id = null;
  }
  redirect(id ? `/anime/${id}` : "/");
}
