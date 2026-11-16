"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Download,
  Minus,
  Plus,
  Play,
  RotateCw,
  Server,
  Settings,
  SkipForward,
  Zap,
} from "lucide-react";
import { megaPlayUrl, PLAYER_MODES, isSubtitleMode, type PlayerMode } from "@/lib/sources";
import { toVtt } from "@/lib/stream/vtt";
import {
  DEFAULT_CAPTION_SETTINGS,
  captionOverlayStyle,
  loadCaptionSettings,
  saveCaptionSettings,
  type CaptionSettings,
} from "@/lib/caption-settings";
import CaptionOverlay from "./caption-overlay";
import TranslateMenu, { type AppliedCaptions } from "./translate-menu";
import HlsPlayer from "./hls-player";
import CaptionSettingsPanel from "./caption-settings-panel";
import { getSessionId } from "@/lib/client-session";
import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";

type Props = {
  anilistId: number;
  malId: number | null;
  episode: number;
  epTotal: number;
  color: string;
  titleRomaji: string | null;
  titleEnglish: string | null;
  cover: string | null;
};

type Side = {
  servers: {
    id: string;
    label: string;
    url: string | null;
    embedUrl?: string;
    subtitles?: { label: string; url: string }[];
  }[];
  subtitles: { label: string; url: string }[];
};

type SourcesPayload = {
  provider: string;
  sub: Side | null;
  hsub: Side | null;
  dub: Side | null;
  embeds?: { sub: string | null; hsub: string | null; dub: string | null } | null;
};

function dedupeSubtitleTracksInline(track: { label: string; url: string }[]): { label: string; url: string }[] {
  const seen = new Set<string>();
  return track
    .filter((t) => Boolean(t.url) && !seen.has(t.url) && Boolean(seen.add(t.url)))
    .sort((a, b) => {
      const ae = /english|\beng\b/i.test(a.label) ? 0 : 1;
      const be = /english|\beng\b/i.test(b.label) ? 0 : 1;
      return ae - be;
    });
}

export default function Player(props: Props) {
  const { anilistId, episode, epTotal } = props;

  const [mode, setMode] = useState<PlayerMode>("sub");
  const [reloadKey, setReloadKey] = useState(0);
  const [sources, setSources] = useState<SourcesPayload | null>(null);
  /** -1 = MegaPlay embedded server, >=0 = direct HLS server index */
  const [sourceSel, setSourceSel] = useState(-1);
  const [applied, setApplied] = useState<AppliedCaptions>(null);
  const [iframeTime, setIframeTime] = useState(0);
  const [synced, setSynced] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [hoverPlayer, setHoverPlayer] = useState(false);
  const [hsubSel, setHsubSel] = useState(0);
  /** Caption track chosen from the translate bar under the video. */
  const [hlsCaptions, setHlsCaptions] = useState<AppliedCaptions>(null);
  const [capSettings, setCapSettings] = useState<CaptionSettings>(loadCaptionSettings());
  const [capSettingsOpen, setCapSettingsOpen] = useState(false);
  /** Caption time offset (seconds), seeded from persisted settings. */
  const [offset, setOffset] = useState(() => capSettings.offsetMs / 1000);

  /** Persist the timing nudge so it survives episode/navigation changes. */
  const setOffsetPersisted = (next: number) => {
    const clamped = Math.max(-5, Math.min(5, next));
    const rounded = Math.round(clamped * 10) / 10;
    setOffset(rounded);
    saveCaptionSettings({ ...capSettings, offsetMs: Math.round(rounded * 1000) });
  };
  const [fallbackAttempts, setFallbackAttempts] = useState(0);

  const handleFatal = useCallback(() => {
    if (fallbackAttempts >= 2) return;
    // Hard Sub has its own list/index; skipping must advance hsubSel, not
    // sourceSel (which indexes the SUB/DUB list and would do nothing here).
    if (mode === "hardsub") {
      const list = sources?.hsub?.servers ?? [];
      const next = list.findIndex((s, i) => i > hsubSel && Boolean(s.url));
      if (next >= 0) {
        setFallbackAttempts((n) => n + 1);
        setHsubSel(next);
      }
      return;
    }
    const side = mode === "dub" ? sources?.dub : sources?.sub;
    const servers = side?.servers ?? [];
    const currentIdx = sourceSel >= 0 ? Math.min(sourceSel, servers.length - 1) : -1;
    const nextTranslateReady = servers.slice(currentIdx + 1).findIndex(
      (s) => Boolean(s.url) && (s.subtitles?.length ?? 0) > 0,
    );
    const nextAny = servers.slice(currentIdx + 1).findIndex((s) => Boolean(s.url));
    const nextIdx =
      nextTranslateReady >= 0
        ? currentIdx + 1 + nextTranslateReady
        : nextAny >= 0
          ? currentIdx + 1 + nextAny
          : -1;
    if (nextIdx >= 0) {
      setFallbackAttempts((n) => n + 1);
      setSourceSel(nextIdx);
    }
  }, [fallbackAttempts, hsubSel, mode, sources, sourceSel]);

  // Load persisted preferences.
  useEffect(() => {
    setCapSettings(loadCaptionSettings());
    const saved = localStorage.getItem("na_mode");
    if (saved === "sub" || saved === "hardsub" || saved === "dub") setMode(saved);
  }, []);

  const updateCapSettings = (next: CaptionSettings) => {
    setCapSettings(next);
    saveCaptionSettings(next);
  };

  // Record watch history whenever the episode changes.
  useEffect(() => {
    fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        animeId: props.anilistId,
        episode: props.episode,
        titleRomaji: props.titleRomaji,
        titleEnglish: props.titleEnglish,
        cover: props.cover,
        color: props.color,
      }),
    }).catch(() => {});
    // Auto-add to watchlist so it appears in My Watchlist (per-user via uid cookie).
    fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        animeId: props.anilistId,
        titleRomaji: props.titleRomaji,
        titleEnglish: props.titleEnglish,
        cover: props.cover,
        color: props.color,
        format: null,
        status: null,
        score: null,
        episode: props.episode,
      }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.anilistId, props.episode]);

  // Resolve direct HLS servers + subtitles for this episode.
  useEffect(() => {
    let cancelled = false;
    let fullDone = false;
    let fastLoaded = false;
    let fastPayload: SourcesPayload | null = null;

    setSources(null);
    setSourceSel(-1);
    setApplied(null);
    setHlsCaptions(null);
    setFallbackAttempts(0);

    /** Deep-merge: when fast-source arrived first and full-source is late (or
        times out on mobile), keep fast-source servers that the full-source
        didn't return so users always see every available server. */
    function mergeSources(base: SourcesPayload | null, extra: SourcesPayload | null): SourcesPayload {
      const mergeSide = (
        b: Side | null,
        e: Side | null,
      ): Side | null => {
        if (!e && !b) return null;
        if (!e) return b;
        if (!b) return e;
        const seenNames = new Set<string>();
        const seenUrls = new Set<string>();
        const merged = [
          ...(e.servers ?? []),
          ...(b.servers ?? []).filter((s) => {
            const nk = (s.label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
            const uk = (s.url ?? s.embedUrl ?? s.id).trim();
            if (seenNames.has(nk) || seenUrls.has(uk)) return false;
            seenNames.add(nk);
            seenUrls.add(uk);
            return true;
          }),
        ];
        return {
          servers: merged,
          subtitles: dedupeSubtitleTracksInline([...(e.subtitles ?? []), ...(b.subtitles ?? [])]),
        };
      };
      return {
        provider: base?.provider ?? extra?.provider ?? "merged",
        sub: mergeSide(base?.sub ?? null, extra?.sub ?? null),
        hsub: base?.hsub ?? extra?.hsub ?? null,
        dub: mergeSide(base?.dub ?? null, extra?.dub ?? null),
        embeds: {
          sub: base?.embeds?.sub ?? extra?.embeds?.sub ?? null,
          hsub: base?.embeds?.hsub ?? extra?.embeds?.hsub ?? null,
          dub: base?.embeds?.dub ?? extra?.embeds?.dub ?? null,
        },
      };
    }

    const applySources = (j: SourcesPayload) => {
      setSources(j);
      const side = mode === "dub" ? j.dub : j.sub;
      const servers = side?.servers ?? [];
      const withSubtitles = servers.findIndex((s) => Boolean(s.url) && (s.subtitles?.length ?? 0) > 0);
      const directIndex = withSubtitles >= 0 ? withSubtitles : servers.findIndex((s) => Boolean(s.url));
      setSourceSel(directIndex >= 0 ? directIndex : -1);
    };

    // Fast-first: AHSANIME is AniList-id based and usually responds in ~1–2s.
    // Dragon Girl Problem gets its AHSANIME ReHD/HD-2 pills from this path while
    // slower title-based providers continue resolving in the background.
    fetch(`/api/stream/fast-sources?animeId=${anilistId}&ep=${episode}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SourcesPayload | null) => {
        if (cancelled || fullDone || !j) return;
        const hasServers = Boolean(j.sub?.servers?.length || j.dub?.servers?.length);
        if (!hasServers) return;
        fastLoaded = true;
        fastPayload = j;
        applySources(j);
      })
      .catch(() => {});

    // Full resolver: authoritative merged list (Anikoto/AniPM/JustAnime/AHSANIME).
    const titlesParam = `&romaji=${encodeURIComponent(props.titleRomaji || "")}&english=${encodeURIComponent(props.titleEnglish || "")}`;
    fetch(`/api/stream/sources?animeId=${anilistId}&ep=${episode}${titlesParam}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SourcesPayload | null) => {
        if (cancelled || !j) return;
        fullDone = true;
        // Merge with any fast-source results so mobile users (whose full-source
        // request is slow) still see AHSANIME servers alongside the full list.
        applySources(fastPayload ? mergeSources(j, fastPayload) : j);
      })
      .catch(() => {
        if (!cancelled && !fastLoaded) {
          setSources({
            provider: "embed",
            sub: null,
            hsub: null,
            dub: null,
            embeds: null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [anilistId, episode]);

  // MegaPlay embed player events → time sync + auto-next.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.origin !== "string" || !e.origin.includes("megaplay.buzz")) return;
      let data = e.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== "object") return;
      const t =
        typeof data.time === "number"
          ? data.time
          : typeof data.currentTime === "number"
            ? data.currentTime
            : null;
      if (t !== null && Number.isFinite(t)) {
        setIframeTime(t);
        setSynced(true);
      }
      if (data.event === "complete") setShowNext(true);
      if (data.event === "time") setShowNext(false);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Page-exit cleanup of temp translations.
  useEffect(() => {
    const cleanup = () => {
      fetch(
        `/api/stream/subtitle/translate?sessionId=${getSessionId()}&animeId=${anilistId}&ep=${episode}`,
        { method: "DELETE", keepalive: true },
      ).catch(() => {});
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") cleanup();
    };
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("beforeunload", cleanup);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", cleanup);
      window.removeEventListener("beforeunload", cleanup);
      document.removeEventListener("visibilitychange", onHidden);
      // Leaving this episode (route change / unmount) drops the temp captions.
      cleanup();
    };
  }, [anilistId, episode]);

  const changeMode = (m: PlayerMode) => {
    setMode(m);
    localStorage.setItem("na_mode", m);
    if (!isSubtitleMode(m)) setApplied(null);
    // Hard Sub indexes hsubSel, not sourceSel — leave the SUB/DUB index alone.
    if (m === "hardsub") return;
    const side = m === "dub" ? sources?.dub : sources?.sub;
    const servers = side?.servers ?? [];
    const withSubtitles = servers.findIndex((s) => Boolean(s.url) && (s.subtitles?.length ?? 0) > 0);
    const directIndex = withSubtitles >= 0 ? withSubtitles : servers.findIndex((s) => Boolean(s.url));
    setSourceSel(directIndex >= 0 ? directIndex : -1);
  };

  /**
   * Mobile stacks SUB / Hard Sub / DUB sections vertically, so a pill from an
   * INACTIVE section is tappable while another mode owns the player. `sourceSel`
   * and `hsubSel` are indexes into the ACTIVE side's list, so the mode has to be
   * switched before the index means anything — otherwise a DUB pill lands on
   * whatever SUB server happens to sit at that index (or on the embed).
   */
  const pickServer = (m: PlayerMode, i: number) => {
    if (m !== mode) {
      setMode(m);
      localStorage.setItem("na_mode", m);
      if (!isSubtitleMode(m)) setApplied(null);
    }
    setSourceSel(i);
  };

  const pickHsubServer = (i: number) => {
    if (mode !== "hardsub") {
      setMode("hardsub");
      localStorage.setItem("na_mode", "hardsub");
      setApplied(null);
    }
    setHsubSel(i);
  };

  /* ---- Decide what renders inside the player frame ---- */

  const activeSide: Side | null = mode === "dub" ? (sources?.dub ?? null) : (sources?.sub ?? null);
  const directServers = activeSide?.servers ?? [];
  const hsubSide: Side | null = sources?.hsub ?? null;
  const hsubServers = hsubSide?.servers ?? [];
  // Hard Sub picks from its own list via hsubSel, not sourceSel.
  const hsubSelected =
    mode === "hardsub" && hsubServers.length
      ? hsubServers[Math.min(hsubSel, hsubServers.length - 1)]
      : undefined;
  const selected =
    mode === "hardsub"
      ? hsubSelected
      : sourceSel >= 0 && directServers.length
        ? directServers[Math.min(sourceSel, directServers.length - 1)]
        : undefined;
  // Hard Sub servers resolve to real burnt-in HLS just like SUB/DUB, so the
  // picked server must actually be played. Only fall back to the MegaPlay
  // hardsub embed when the picked server is embed-only.
  const hlsDirect = Boolean(selected?.url);
  const currentServer = hlsDirect ? selected : undefined;
  const currentUrl = currentServer?.url ?? null;
  const sideTracks =
    mode === "sub"
      ? (sources?.sub?.subtitles ?? [])
      : mode === "dub"
        ? (sources?.dub?.subtitles ?? [])
        : [];
  const englishUrl =
    (selected?.subtitles ?? sideTracks).find((t) => /english|\beng\b/i.test(t.label))?.url ??
    (selected?.subtitles ?? sideTracks)[0]?.url ??
    null;

  // Embed url: prefer the Anikoto-mapped per-episode embed (correct mapping),
  // fall back to the naive MegaPlay pattern.
  const embedFor = (m: PlayerMode): string => {
    const key = m === "hardsub" ? "hsub" : m;
    const mapped = sources?.embeds?.[key];
    return mapped ?? megaPlayUrl(anilistId, episode, m === "sub" ? "sub" : m);
  };
  // A picked server may be embed-only (AnimeKai style). Use its embed URL.
  const pickedServer =
    sourceSel >= 0 && directServers.length
      ? directServers[Math.min(sourceSel, directServers.length - 1)]
      : undefined;
  const iframeSrc =
    mode === "hardsub" && hsubSelected
      ? (hsubSelected.embedUrl ?? embedFor(mode))
      : pickedServer && !pickedServer.url && pickedServer.embedUrl
        ? pickedServer.embedUrl
        : embedFor(mode);
   // Caption/translate tools: shown whenever we have an English VTT track,
   // whether the video plays via direct HLS or an embed iframe.
   const captionTools = isSubtitleMode(mode) && Boolean(englishUrl);
   const iframeCaptionTools = captionTools;

  const stillResolving = sources === null;

  return (
    <div>
       {/* Player frame */}
      <div
        className="group/player relative w-full overflow-hidden rounded-xl border border-white/10 bg-black sm:rounded-2xl"
        style={{
          aspectRatio: "16 / 9",
          minHeight: "180px",
          boxShadow: `0 16px 40px -12px ${props.color}44`,
        }}
        onMouseEnter={() => setHoverPlayer(true)}
        onMouseLeave={() => setHoverPlayer(false)}
      >
        {/* Never block playback: show the embed first, upgrade to direct HLS
            in place once the resolver finds servers. */}
{hlsDirect && currentServer && currentUrl ? (
          <HlsPlayer
            key={`${mode}-${anilistId}-${episode}-${currentServer.id}`}
            src={
              currentUrl.includes("streamfile")
                ? currentUrl
                : `/api/stream/proxy?url=${encodeURIComponent(currentUrl)}`
            }
            progressive={
              /\.mp4(?:$|\?)/i.test(currentUrl) || currentUrl.includes("streamfile")
            }
            magnet={
              currentUrl.includes("streamfile") ? (currentServer as any).magnet ?? null : null
            }
            englishUrl={englishUrl}
            animeId={anilistId}
            ep={episode}
            epTotal={epTotal}
            title={props.titleRomaji || props.titleEnglish || `anime-${anilistId}`}
            captions={hlsCaptions || applied}
            onCaptionsChange={setHlsCaptions}
            capSettings={capSettings}
            offset={offset}
            onFatal={handleFatal}
          />
         ) : (
          <>
            <iframe
              key={`${iframeSrc}-${reloadKey}`}
              src={iframeSrc}
              className="absolute inset-0 h-full w-full"
              allowFullScreen
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              referrerPolicy="origin"
              title={`Episode ${episode}`}
            />
              {/* Download button for iframe mode — downloads the applied
                  (translated) subtitle track, falling back to English. */}
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const dlTitle = (props.titleRomaji || props.titleEnglish || `anime-${props.anilistId}`)
                    .replace(/[^a-zA-Z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .toLowerCase();
                  const base = `${dlTitle || `anime-${props.anilistId}`}-ep${episode}`;

                  let vtt: string | null = null;
                  let lang = "english";
                  if (applied && applied.cues.length > 0) {
                    // Translated track currently shown on screen.
                    vtt = toVtt(applied.cues.map((c, i) => ({ id: i + 1, ...c })));
                    lang = applied.lang || applied.label;
                  } else if (englishUrl) {
                    const res = await fetch(`/api/stream/subtitle?url=${encodeURIComponent(englishUrl)}`);
                    if (res.ok) vtt = await res.text();
                  }
                  if (!vtt) return;

                  const blob = new Blob([vtt], { type: "text/vtt" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${base}-sub-${lang.toLowerCase()}.vtt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                disabled={!englishUrl && !(applied && applied.cues.length > 0)}
                className={cn(
                  "absolute top-3 right-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur transition-all hover:bg-white/10",
                  !englishUrl && !(applied && applied.cues.length > 0) && "opacity-40",
                )}
                title={
                  applied && applied.cues.length > 0
                    ? `Download ${applied.label} subtitles`
                    : englishUrl
                      ? "Download subtitles"
                      : "Subtitles unavailable for download"
                }
                aria-label="Download subtitles"
              >
                <Download className="h-4 w-4" />
              </button>
              {/* Offline video download button for direct HLS mode */}
              {hlsDirect && currentServer && currentUrl && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!("serviceWorker" in navigator)) {
                      alert("Offline download requires a modern browser");
                      return;
                    }
                    const swRegistration = await navigator.serviceWorker.ready;
                    if (!swRegistration.active) {
                      alert("Service worker not ready");
                      return;
                    }
                    const dlTitle = (props.titleRomaji || props.titleEnglish || `anime-${props.anilistId}`)
                      .replace(/[^a-zA-Z0-9]+/g, "-")
                      .replace(/^-+|-+$/g, "")
                      .toLowerCase();
                    
                    swRegistration.active.postMessage({
                      type: "DOWNLOAD_VIDEO",
                      payload: {
                        m3u8Url: currentUrl.includes("streamfile") ? currentUrl : `/api/stream/proxy?url=${encodeURIComponent(currentUrl)}`,
                        title: dlTitle || `anime-${props.anilistId}`,
                        episode: episode
                      }
                    });
                    alert("Download started! Check notifications when complete.");
                  }}
                  className={cn(
                    "absolute top-3 right-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur transition-all hover:bg-white/10",
                  )}
                  title="Download episode for offline viewing"
                  aria-label="Download episode for offline viewing"
                >
                  <Download className="h-4 w-4" />
                  <Zap className="h-4 w-4 ml-1 text-[#c084fc]" />
                </button>
              )}
            {iframeCaptionTools && applied && (
              <CaptionOverlay
                cues={applied.cues}
                currentTime={iframeTime}
                offset={offset}
                line={capSettings.position}
                style={captionOverlayStyle(capSettings)}
              />
            )}
            {showNext && (epTotal === 0 || episode < epTotal) && (
              <div className="absolute bottom-12 right-4 z-30 animate-fade-up">
                <Link
                  href={`/watch/${anilistId}/${episode + 1}`}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] px-5 py-3 text-sm font-bold text-white shadow-2xl shadow-[#8b5cf6]/40 transition-transform hover:scale-105"
                >
                  <SkipForward className="h-4 w-4 fill-white" />
                  Next: Episode {episode + 1}
                </Link>
              </div>
            )}
            {iframeCaptionTools && applied && (
              <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider backdrop-blur">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                     synced ? "bg-emerald-400" : "animate-pulse bg-[#c084fc]",
                  )}
                />
                <span className={synced ? "text-emerald-300" : "text-[#c084fc]"}>
                  {synced ? `${applied.label} · synced` : `${applied.label} · press play to sync`}
                </span>
              </div>
            )}
          </>
        )}

        {/* "Upgrading to direct HLS" hint while resolver works */}
        {stillResolving && mode !== "hardsub" && (
          <div className="absolute left-3 top-3 z-30 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[10px] font-bold text-zinc-300 backdrop-blur animate-fade-in">
            <span className="h-3 w-3 animate-spin rounded-full border border-white/25 border-t-[#8b5cf6]" />
            Finding direct servers…
          </div>
        )}
      </div>

      {/* Translate bar — sits directly under the video so the language list
          is always reachable (never clipped inside the player overlay).
          Picking a language swaps the caption track on the running video. */}
      {hlsDirect && englishUrl && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            <Captions className="h-3.5 w-3.5 shrink-0 text-[#c084fc]" />
            <span className="truncate">
              {hlsCaptions ? hlsCaptions.label : "Subtitles"}
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <button
                onClick={() => setCapSettingsOpen((v) => !v)}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-full bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white",
                  capSettingsOpen && "text-[#c084fc]",
                )}
                title="Caption style & position"
                aria-label="Caption settings"
              >
                <Settings className="h-4 w-4" />
              </button>
              {capSettingsOpen && (
                <CaptionSettingsPanel
                  settings={capSettings}
                  onChange={updateCapSettings}
                  onClose={() => setCapSettingsOpen(false)}
                />
              )}
            </div>
            <TranslateMenu
              key={englishUrl}
              englishUrl={englishUrl}
              animeId={anilistId}
              ep={episode}
              onApply={setHlsCaptions}
              direction="down"
            />
          </div>
        </div>
      )}

      {/* Server card — modes on top, named servers underneath */}
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:mt-4 sm:p-3.5">
        {/* Mobile: vertical sections (Sub / Hard Sub / Dub) with server lists */}
        <div className="space-y-3 sm:hidden">
          {PLAYER_MODES.map((m) => {
            const mSide =
              m.id === "hardsub"
                ? hsubSide
                : m.id === "dub"
                  ? (sources?.dub ?? null)
                  : (sources?.sub ?? null);
            const mServers = mSide?.servers ?? [];
            const mActive = m.id === mode;
            return (
              <div key={m.id}>
                <button
                  onClick={() => changeMode(m.id)}
                  className={cn(
                    "mb-1.5 flex w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-bold text-zinc-300 transition-all",
                    mActive && "border-[#8b5cf6] bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white",
                  )}
                >
                  {m.id === "sub" && <Captions className="h-3.5 w-3.5" />}
                  {m.label}
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                   {m.id === "hardsub" &&
                     mServers.map((s, i) => (
                       <button
                         key={s.id}
                         onClick={() => pickHsubServer(i)}
                         className={cn(
                           "shrink-0 rounded-full border px-3.5 py-1.5 text-[11px] font-bold transition-all whitespace-nowrap",
                           mActive && i === hsubSel
                             ? "border-[#8b5cf6] bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white shadow"
                             : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/30 hover:text-white",
                         )}
                       >
                         {s.label}
                         {mActive && i === hsubSel && <Play className="ml-1 h-3 w-3 fill-current" />}
                       </button>
                     ))}

                   {m.id !== "hardsub" &&
                     mServers.map((s, i) => {
                       const active = mActive && hlsDirect && sourceSel === i;
                       const translateReady = Boolean(s.url) && (mSide?.subtitles.length ?? 0) > 0;
                       return (
                         <button
                           key={s.id}
                           onClick={() => pickServer(m.id, i)}
                           className={cn(
                             "shrink-0 flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all whitespace-nowrap",
                             active
                               ? "border-[#8b5cf6] bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white shadow"
                               : translateReady
                                 ? "border-[#c084fc]/40 bg-[#c084fc]/[0.08] text-[#c084fc]/[0.9] hover:border-[#c084fc]/70"
                                 : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/30 hover:text-white",
                           )}
                         >
                           {s.label}
                           {active && <Play className="h-2.5 w-2.5 fill-current" />}
                           {s.url && translateReady && !active && <Globe className="h-2.5 w-2.5 opacity-80" />}
                         </button>
                       );
                     })}
                 </div>

                 {stillResolving && mActive && m.id !== "hardsub" &&
                   [1, 2, 3].map((i) => (
                     <span key={i} className="skeleton h-8 w-24 rounded-full" />
                   ))}
               </div>
             );
           })}

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                if (mode === "hardsub") {
                  setMode("sub");
                  localStorage.setItem("na_mode", "sub");
                }
                setSourceSel(-1);
              }}
              className={cn(
                "shrink-0 flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-bold transition-all",
                sourceSel === -1
                  ? "border-[#8b5cf6] bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white shadow"
                  : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/30 hover:text-white",
              )}
            >
              {sourceSel === -1 && <Play className="h-2.5 w-2.5 fill-current" />}
              Embed fallback ({sources?.provider ?? "embed"})
            </button>
          </div>

          {!stillResolving && mode !== "hardsub" && directServers.length === 0 && (
            <span className="text-[11px] text-zinc-600">
              Direct servers unavailable — embed is serving this episode.
            </span>
          )}
        </div>

        {/* Desktop: tab-based layout (mode buttons + server pills) */}
        <div className="hidden sm:block">
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5 sm:mb-3 sm:gap-2">
            {PLAYER_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => changeMode(m.id)}
                title={m.hint}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold transition-all whitespace-nowrap sm:flex-none sm:px-4",
                  mode === m.id
                    ? "bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white shadow"
                    : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white",
                )}
              >
                {m.id === "sub" && <Captions className="h-3.5 w-3.5" />}
                {m.label}
              </button>
            ))}
            {activeSide && activeSide.subtitles.length > 0 && (
              <span className="ml-auto flex items-center gap-1 rounded-full bg-[#c084fc]/15 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#c084fc]">
                <Globe className="h-2.5 w-2.5" /> CC · Translate ready
              </span>
            )}
          </div>

          <div className="no-scrollbar -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:gap-2">
             {/* Embed fallback server */}
            <button
              onClick={() => setSourceSel(-1)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-bold transition-all whitespace-nowrap",
                  sourceSel === -1
                    ? "border-[#8b5cf6] bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white shadow"
                    : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/30 hover:text-white",
                )}
            >
              {sourceSel === -1 && <Play className="h-2.5 w-2.5 fill-current" />}
              Embed ({sources?.provider ?? "embed"})
            </button>

            {mode === "hardsub" &&
              (hsubSide?.servers ?? []).map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setHsubSel(i)}
                  className={cn(
                    "shrink-0 rounded-full border px-3.5 py-1.5 text-[11px] font-bold transition-all whitespace-nowrap",
                    i === hsubSel
                      ? "border-[#8b5cf6] bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white shadow"
                      : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/30 hover:text-white",
                  )}
                >
                  {s.label}
                  {i === hsubSel && <Play className="ml-1 h-2.5 w-2.5 fill-current" />}
                </button>
              ))}

             {mode !== "hardsub" &&
              directServers.map((s, i) => {
                const active = hlsDirect && sourceSel === i;
                const translateReady = Boolean(s.url) && (activeSide?.subtitles.length ?? 0) > 0;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSourceSel(i)}
                    className={cn(
                      "shrink-0 flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all whitespace-nowrap sm:gap-1.5 sm:px-3.5",
                      active
                        ? "border-[#8b5cf6] bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white shadow"
                        : translateReady
                          ? "border-[#c084fc]/40 bg-[#c084fc]/[0.08] text-[#c084fc]/[0.9] hover:border-[#c084fc]/70"
                          : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/30 hover:text-white",
                    )}
                  >
                    {s.label}
                    {active && <Play className="h-3 w-3 fill-current" />}
                    {s.url && translateReady && !active && <Globe className="h-2.5 w-2.5 opacity-80" />}
                  </button>
                );
              })}

            {stillResolving && mode !== "hardsub" &&
              [1, 2, 3].map((i) => (
                <span key={i} className="skeleton h-8 w-24 rounded-full" />
              ))}

            {!stillResolving && mode !== "hardsub" && directServers.length === 0 && (
              <span className="text-[11px] text-zinc-600">
                direct sources unavailable for this episode — MegaPlay embed is serving it
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-3 sm:hidden">
        {/* Mobile bottom-fixed translate toolbar */}
        {captionTools && !stillResolving && (
          <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-2 border-t border-white/10 bg-[#0a0a14]/95 px-3 py-2.5 backdrop-blur-lg">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <Captions className="h-3.5 w-3.5 text-[#c084fc]" /> Subtitles
            </span>
            <TranslateMenu
              englishUrl={englishUrl}
              animeId={anilistId}
              ep={episode}
              onApply={hlsDirect ? setHlsCaptions : setApplied}
              direction="up"
            />
          </div>
        )}
      </div>

      <div className="mt-3 hidden flex-wrap items-center gap-2 sm:gap-3 sm:flex">
        {/* Desktop caption tools row (translate menu + caption settings) */}
        {captionTools && !stillResolving && (
          <>
            {applied && (
              <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                <button
                  onClick={() => setOffsetPersisted(offset - 0.5)}
                  title="Captions earlier (−0.5s)"
                  className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:text-white"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="min-w-14 text-center text-[10px] font-bold text-zinc-400">
                  {offset > 0 ? `+${offset.toFixed(1)}` : offset.toFixed(1)}s
                </span>
                <button
                  onClick={() => setOffsetPersisted(offset + 0.5)}
                  title="Captions later (+0.5s)"
                  className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:text-white"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            )}
             <TranslateMenu
              englishUrl={englishUrl}
              animeId={anilistId}
              ep={episode}
              onApply={hlsDirect ? setHlsCaptions : setApplied}
            />
          </>
        )}

        {mode === "hardsub" && (
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            title="Reload player"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition-all hover:border-[#8b5cf6]/50 hover:text-[#c084fc]"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {episode > 1 ? (
            <Link
              href={`/watch/${anilistId}/${episode - 1}`}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-zinc-300 transition-all hover:border-[#8b5cf6]/50 hover:text-white"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Link>
          ) : (
            <span className="flex cursor-not-allowed items-center gap-1.5 rounded-full border border-white/5 bg-white/[0.02] px-4 py-2 text-xs font-semibold text-zinc-600">
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] px-4 py-2 text-xs font-bold text-white">
            EP {episode}{epTotal ? ` / ${epTotal}` : ""}
          </span>
          {epTotal === 0 || episode < epTotal ? (
            <Link
              href={`/watch/${anilistId}/${episode + 1}`}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-zinc-300 transition-all hover:border-[#8b5cf6]/50 hover:text-white"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className="flex cursor-not-allowed items-center gap-1.5 rounded-full border border-white/5 bg-white/[0.02] px-4 py-2 text-xs font-semibold text-zinc-600">
              Next <ChevronRight className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-zinc-600">
        {hlsDirect ? (
          <>
            <Zap className="h-3 w-3 text-[#c084fc]" />
            Direct HLS ({sources?.provider ?? ""}) — servers named like the source network; violet ones are translate-ready.
          </>
        ) : (
          <>
            <Server className="h-3 w-3" />
            Embed player — if playback stalls, switch between SUB / Hard Sub / DUB.
          </>
        )}
      </p>
    </div>
  );
}
