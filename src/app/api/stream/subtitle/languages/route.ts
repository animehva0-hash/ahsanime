import { SUBTITLE_LANGUAGES } from "@/lib/stream/languages";
import { isGeminiConfigured, translateModel, TRANSLATE_PROVIDER } from "@/lib/stream/gemini";

export const dynamic = "force-dynamic";

/** Language catalog + provider/model/key status. */
export async function GET() {
  const configured = isGeminiConfigured();
  return Response.json({
    ok: true,
    provider: TRANSLATE_PROVIDER,
    model: translateModel(),
    configured,
    status: configured
      ? "ready"
      : "GOOGLE_TRANSLATE_API_KEY not configured — original English captions remain available",
    languages: SUBTITLE_LANGUAGES,
    count: SUBTITLE_LANGUAGES.length,
  });
}
