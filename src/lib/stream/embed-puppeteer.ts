import { spawn } from "child_process";
import { promisify } from "util";

const execFile = promisify(require("child_process").execFile);

export type EmbedServer = {
  name: string;
  type: "sub" | "dub";
  hls: string | null;
  embedUrl: string | null;
  vtt: { label: string; url: string }[];
  referer: string;
};

const PYTHON_BIN = "/tmp/scrapling-venv/bin/python3";
const SCRAPER_SCRIPT = "/tmp/scrapling-venv/anime_scraper.py";

async function scrapeEmbed(url: string): Promise<{
  hls: string | null;
  embedUrl: string | null;
  vtt: { label: string; url: string }[];
  error: string | null;
}> {
  try {
    const { stdout } = await execFile(PYTHON_BIN, [SCRAPER_SCRIPT, url], {
      maxBuffer: 10 * 1024 * 1024, // 10MB max output
      timeout: 45000, // 45 second timeout
    });
    return JSON.parse(stdout);
  } catch (err: any) {
    return {
      hls: null,
      embedUrl: null,
      vtt: [],
      error: err?.message || String(err),
    };
  }
}

async function resolveEmbedPuppeteer(params: {
  embedUrls: Array<{ url: string; name: string }>;
  type: "sub" | "dub";
  ep: number;
}): Promise<EmbedServer> {
  const { embedUrls, type, ep } = params;

  for (const { url: embedUrl, name } of embedUrls) {
    const result = await scrapeEmbed(embedUrl);

    if (result.error && !result.hls && !result.embedUrl) continue;

    // Prefer HLS, fall back to embed URL found by scraper (may differ from input URL)
    const hls = result.hls || null;
    const foundEmbedUrl = result.embedUrl || embedUrl;
    const embed = hls || foundEmbedUrl ? foundEmbedUrl : null;

    if (hls || embed) {
      return {
        name,
        type,
        hls,
        embedUrl: embed,
        vtt: result.vtt ?? [],
        referer: embedUrl,
      };
    }
  }

  return {
    name: embedUrls[0]?.name || "Embed",
    type,
    hls: null,
    embedUrl: null,
    vtt: [],
    referer: embedUrls[0]?.url || "",
  };
}

export { resolveEmbedPuppeteer };
