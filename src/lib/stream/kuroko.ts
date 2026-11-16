const BASE = "https://kuroko.cc";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type KuServer = {
  name: string;
  type: "sub" | "dub";
  hls: string | null;
  vtt: { label: string; url: string }[];
  referer: string;
};

type KuApiServer = {
  name: string;
  provider: string;
  type: string;
  quality: string;
  url: string;
  isM3U8: boolean;
  subs: Array<{ url: string; label: string }>;
  intro: string | null;
  outro: string | null;
};

type KuApiResponse = {
  ok: boolean;
  servers: KuApiServer[];
  error?: string;
  took?: number;
};

async function getWithCookie(url: string, referer: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        Referer: referer,
        Origin: BASE,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function isPlayable(hlsUrl: string, referer: string): Promise<boolean> {
  try {
    const res = await fetch(hlsUrl, {
      method: "HEAD",
      headers: {
        "User-Agent": UA,
        Referer: referer,
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const g = globalThis as unknown as { __na_ku?: KuServer[] };
const cache: KuServer[] | null = (g.__na_ku ?? null);

export async function resolveKuroko(params: {
  anilistId: number;
  ep: number;
}): Promise<KuServer[]> {
  const { anilistId, ep } = params;

  const watchUrl = `${BASE}/watch?id=${anilistId}&ep=${ep}`;

  // Step 1: Visit the watch page to establish cookie session.
  await getWithCookie(watchUrl, BASE + "/");

  // Step 2: Call the stream API with the established cookies.
  const apiUrl = `${BASE}/index.php?page=api.stream&id=${anilistId}&ep=${ep}`;
  const text = await getWithCookie(apiUrl, watchUrl);
  if (!text) return [];

  let data: KuApiResponse;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  if (!data.ok || !data.servers || !data.servers.length) return [];

  const results: KuServer[] = [];

  for (const sv of data.servers) {
    if (!sv.url || !sv.isM3U8) continue;

    const type = sv.type.toLowerCase() === "dub" ? "dub" : "sub";

    const vtt = sv.subs
      .filter((s) => s.url && s.label)
      .map((s) => ({
        label: s.label,
        url: s.url,
      }));

    if (!(await isPlayable(sv.url, watchUrl))) continue;

    results.push({
      name: sv.name || "Kuroko",
      type,
      hls: sv.url,
      vtt,
      referer: watchUrl,
    });
  }

  return results;
}
