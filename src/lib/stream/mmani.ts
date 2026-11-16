const BASE = "https://mmani.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const KF_REQ = "20821feefa3cd385c5850cc8";

export type MmServer = {
  name: string;
  type: "sub" | "dub";
  hls: string | null;
  vtt: { label: string; url: string }[];
  referer: string;
};

type MmEpisode = {
  name: string;
  slug: string;
  link: string;
};

type MmServerData = {
  server_name: string;
  id: number;
  server_data: MmEpisode[];
};

type MmSource = {
  server: string;
  link: string;
};

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "X-KF-Req": KF_REQ,
        Referer: BASE + "/",
        Origin: BASE,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function getServers(anilistId: number): Promise<MmServerData[]> {
  const text = await getText(`${BASE}/ajax.php?episodes&epid=${anilistId}`);
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? (data as MmServerData[]) : [];
  } catch {
    return [];
  }
}

async function getSources(dataId: string): Promise<MmSource[]> {
  const text = await getText(`${BASE}/ajax.php?eplink&data=${encodeURIComponent(dataId)}`);
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? (data as MmSource[]) : [];
  } catch {
    return [];
  }
}

async function isPlayable(url: string, referer: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": UA,
        Referer: referer,
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const g = globalThis as unknown as { __na_mm?: MmServer[] };
const cache: MmServer[] | null = (g.__na_mm ?? null);

export async function resolveMMani(params: {
  anilistId: number;
  ep: number;
}): Promise<MmServer[]> {
  const { anilistId, ep } = params;
  const epStr = String(ep).padStart(2, "0");

  const servers = await getServers(anilistId);
  if (!servers.length) return [];

  const results: MmServer[] = [];

  for (const sv of servers) {
    const episode = sv.server_data.find(
      (e) => e.slug === epStr || e.name === epStr
    );
    if (!episode) continue;

    const sources = await getSources(episode.link);
    if (!sources.length) continue;

    const vtt: { label: string; url: string }[] = [];

    for (const src of sources) {
      if (!(await isPlayable(src.link, BASE + "/"))) continue;

      results.push({
        name: src.server || sv.server_name || "MMani",
        type: "sub",
        hls: src.link,
        vtt,
        referer: BASE + "/up/" + anilistId + "/watch/?server=" + sv.id + "&slug=" + episode.slug,
      });
    }
  }

  return results;
}
