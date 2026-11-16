"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type Hls from "hls.js";
import {
  Captions,
  Cast,
  Check,
  Download,
  Globe,
  Loader2,
  Maximize,
  Menu,
  Minimize2,
  MonitorPlay,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { type AppliedCaptions } from "./translate-menu";
import {
  captionCueCss,
  type CaptionSettings,
} from "@/lib/caption-settings";
import { getSessionId } from "@/lib/client-session";
import { parseVtt, shiftCues, toVtt } from "@/lib/stream/vtt";
import { cn } from "@/lib/utils";

type Props = {
  src: string;
  /** True for direct MP4/progressive media (incl. WebTorrent streams); false for HLS playlists. */
  progressive?: boolean;
  /** Magnet link for WebTorrent streams — seeds the torrent before playback. */
  magnet?: string | null;
  englishUrl: string | null;
  animeId: number;
  ep: number;
  epTotal?: number;
  title: string;
  /** Caption track chosen outside the player (translate bar under the video). */
  captions?: AppliedCaptions;
  onCaptionsChange?: (c: AppliedCaptions) => void;
  capSettings: CaptionSettings;
  /** Seconds to shift the active caption track forward/backward. */
  offset?: number;
  onFatal?: () => void;
};

function fmt(t: number) {
  if (!Number.isFinite(t)) return "0:00";
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Append/adjust WebVTT cue `line` position settings. */
function withLinePosition(vtt: string, linePct: number) {
  return vtt.replace(
    /(\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3})([^\n]*)/g,
    (_m, stamps: string) => `${stamps} line:${linePct}%`,
  );
}

type SubLang = { code: string; label: string; native?: string };

export default function HlsPlayer({
  src,
  progressive = false,
  magnet = null,
  englishUrl,
  animeId,
  ep,
  epTotal = 0,
  title,
  captions,
  onCaptionsChange,
  capSettings,
  offset = 0,
  onFatal,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const blobRef = useRef<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
   const [levels, setLevels] = useState<{ height: number; index: number; label: string }[]>([]);
  const [level, setLevel] = useState(-1); // -1 = auto
  const [fit, setFit] = useState<"contain" | "cover">("cover");
  const [hover, setHover] = useState(false);
  const [controlsOn, setControlsOn] = useState(true);
  const [capVtt, setCapVtt] = useState<string | null>(null);
  const [capLabel, setCapLabel] = useState<string | null>(null);
  const [qualityMenu, setQualityMenu] = useState(false);
  const [downloadMenu, setDownloadMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<"quality" | "download" | "menu" | "subtitles" | "episodes" | null>(null);
  const [subLangs, setSubLangs] = useState<SubLang[] | null>(null);
  const [subFilter, setSubFilter] = useState("");
  const [subBusy, setSubBusy] = useState<string | null>(null);
  const [subError, setSubError] = useState<string | null>(null);
  const [subStatus, setSubStatus] = useState<{ kind: "waiting" | "complete" | "error"; text: string } | null>(null);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const subCache = useRef(new Map<string, AppliedCaptions>());
  const subStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canCast, setCanCast] = useState(false);
  // Fit preference
  useEffect(() => {
    const saved = sessionStorage.getItem("na_fit");
    if (saved === "cover" || saved === "contain") setFit(saved);
  }, []);

  // Bounded startup: if still waiting after 20s, stop infinite loading.
  useEffect(() => {
    if (!waiting || fatal) return;
    const t = setTimeout(() => {
      setFatal("This server took too long to respond. Try another server or MegaPlay.");
    }, 20_000);
    return () => clearTimeout(t);
  }, [waiting, fatal]);

  // HLS boot
  useEffect(() => {
    let cancelled = false;
    let hls: Hls | null = null;

    async function boot() {
      const el = video.current;
      if (!el) return;

      // Vidwish/AnimeGG returns a progressive MP4, not an m3u8 playlist.
      // Loading it through hls.js produces subtitles-with-no-video. Native
      // <video> + Range/206 proxying is the correct playback path.
      if (progressive) {
        // If this is a WebTorrent stream, seed the magnet first so the
        // WebTorrent server has the file ready to serve via HTTP Range.
        if (magnet) {
          try {
            await fetch("/api/webtorrent/add", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ magnet }),
              signal: AbortSignal.timeout(20_000),
            });
          } catch {
            // Non-fatal: the server may already be seeding, or the torrent
            // may start on first stream request. Try playback anyway.
          }
        }

        el.src = src;
        el.preload = "metadata";
        el.addEventListener(
          "loadedmetadata",
          () => {
            if (cancelled) return;
            setReady(true);
            setWaiting(false);
            setFatal(null);
            el.play().catch(() => setPlaying(false));
          },
          { once: true },
        );
        el.addEventListener(
          "error",
          () => {
            if (!cancelled) {
              setFatal("This MP4 server could not be loaded. Try another server.");
              onFatal?.();
            }
          },
          { once: true },
        );
        el.load();
        return;
      }

      const { default: HlsCtor } = await import("hls.js");
      if (cancelled) return;

      if (HlsCtor.isSupported()) {
        hls = new HlsCtor({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
        });
        hlsRef.current = hls;
        hls.on(HlsCtor.Events.MANIFEST_PARSED, (_e, data) => {
          const seen = new Map<number, number>();
          const fallbackNames: Record<number, string> = { 0: "Low", 1: "SD", 2: "HD", 3: "Full HD" };
          data.levels.forEach((l, i) => {
            const h = l.height || 0;
            if (h > 0 && !seen.has(h)) seen.set(h, i);
            else if (h === 0 && !seen.size) {
              // Fallback for playlists without height metadata: use level index
              seen.set(i + 1000, i);
            }
          });
          const uniq = [...seen.entries()].map(([key, index]) => {
            const lvl = data.levels[index];
            const isFallback = key >= 1000;
            return {
              height: isFallback ? 0 : key,
              index,
              label: isFallback
                ? `${fallbackNames[seen.size] || `Quality ${seen.size}`}`
                : `${key}p`,
            };
          }).sort((a, b) => b.height - a.height);
          setLevels(uniq);
          setWaiting(false);
          el.play().catch(() => setPlaying(false));
        });
        hls.on(HlsCtor.Events.LEVEL_SWITCHED, () => {
          setWaiting(false);
          const cur = hls?.currentLevel ?? -1;
          if (cur >= 0) setLevel(cur);
        });
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
            hls?.startLoad();
          } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
            hls?.recoverMediaError();
          } else {
            setFatal("This stream could not be started. Try reload.");
            onFatal?.();
          }
        });
        hls.loadSource(src);
        hls.attachMedia(el);
      } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = src;
        el.addEventListener("loadedmetadata", () => {
          setWaiting(false);
          el.play().catch(() => {});
        });
      } else {
        setFatal("HLS is not supported in this browser.");
      }
      setReady(true);
    }

    boot();
    return () => {
      cancelled = true;
      setReady(false);
      hls?.destroy();
      hlsRef.current = null;
    };
  }, [src, progressive, magnet]);

  // Load English captions through the subtitle proxy (forced text/vtt).
  const loadEnglish = useCallback(async () => {
    if (!englishUrl) return null;
    const res = await fetch(`/api/stream/subtitle?url=${encodeURIComponent(englishUrl)}`);
    if (!res.ok) throw new Error("caption load failed");
    return res.text();
  }, [englishUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!englishUrl) return;
    loadEnglish()
      .then((vtt) => {
        if (!cancelled && vtt) {
          setCapVtt(vtt);
          setCapLabel("English");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [englishUrl, loadEnglish]);

  // External (parent-owned) caption selection wins over the internal default.
  useEffect(() => {
    if (captions === undefined) return;
    if (captions === null) {
      setCapVtt(null);
      setCapLabel(null);
      setActiveSub(null);
      return;
    }
    const withId = captions.cues.map((c, i) => ({ id: i + 1, ...c }));
    const shifted = offset ? shiftCues(withId, offset) : withId;
    setCapVtt(toVtt(shifted));
    setCapLabel(captions.label);
    setActiveSub(captions.lang ?? null);
  }, [captions, offset]);

  const linePct = Math.round(capSettings.position);

  // Track management: old tracks disabled & removed before a new one loads.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    blobRef.current && URL.revokeObjectURL(blobRef.current);
    blobRef.current = null;
    for (const t of Array.from(el.textTracks)) t.mode = "disabled";
    el.querySelectorAll("track").forEach((t) => t.remove());
    if (!capVtt) return;

    const positioned = withLinePosition(capVtt, linePct);
    const url = URL.createObjectURL(new Blob([positioned], { type: "text/vtt" }));
    blobRef.current = url;

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = capLabel ?? "Captions";
    track.srclang = capLabel === "English" ? "en" : "translated";
    track.src = url;
    track.default = true;
    el.appendChild(track);
    requestAnimationFrame(() => {
      for (const t of Array.from(el.textTracks)) {
        t.mode = t.language === track.srclang && t.label === track.label ? "showing" : "disabled";
      }
    });
  }, [capVtt, capLabel, linePct]);

  useEffect(
    () => () => {
      blobRef.current && URL.revokeObjectURL(blobRef.current);
    },
    [],
  );

  // Inject the caption <style> so native ::cue rules match the saved settings.
  useEffect(() => {
    const id = "na-cue-style";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = captionCueCss(capSettings);
    return () => {
      if (el) el.textContent = "";
    };
  }, [capSettings]);

  // Controls auto-hide
  const poke = useCallback(() => {
    setControlsOn(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (video.current && !video.current.paused) setControlsOn(false);
    }, 2600);
  }, []);

  useEffect(() => {
    poke();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [poke]);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const el = video.current as any;
      const hasCastSdk = Boolean((window as any).cast?.framework) || Boolean((window as any).chrome?.cast);
      setCanCast(Boolean(hasCastSdk || el?.remote?.prompt || el?.webkitShowPlaybackTargetPicker));
    };
    check();
    const w = window as any;
    if (!w.__naCastInit) {
      w.__naCastInit = "loading";
      const prev = w.__onGCastApiAvailable;
      w.__onGCastApiAvailable = (available: boolean) => {
        try { prev?.(available); } catch {}
        if (!available) { w.__naCastInit = "unavailable"; check(); return; }
        try {
          const ctx = w.cast.framework.CastContext.getInstance();
          ctx.setOptions({
            receiverApplicationId: w.chrome?.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID || "CC1AD845",
            autoJoinPolicy: w.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED,
          });
          w.__naCastInit = "ready";
        } catch {
          w.__naCastInit = "error";
        }
        check();
      };
      if (!document.querySelector('script[data-na-cast-sdk="1"]')) {
        const s = document.createElement("script");
        s.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
        s.async = true;
        s.dataset.naCastSdk = "1";
        s.onerror = () => { w.__naCastInit = "error"; check(); };
        document.head.appendChild(s);
      }
    } else {
      const t = setInterval(check, 1000);
      return () => { cancelled = true; clearInterval(t); };
    }
    const t = setInterval(check, 1200);
    return () => { cancelled = true; clearInterval(t); };
  }, [src]);

  useEffect(() => {
    subCache.current.clear();
    setSubError(null);
    setSubStatus(null);
    if (subStatusTimer.current) clearTimeout(subStatusTimer.current);
  }, [animeId, ep]);

  const loadSubtitleLanguages = useCallback(async () => {
    if (subLangs || !englishUrl) return;
    try {
      const res = await fetch("/api/stream/subtitle/languages");
      if (!res.ok) return;
      const j = await res.json();
      if (j?.languages) setSubLangs(j.languages as SubLang[]);
    } catch {}
  }, [subLangs, englishUrl]);

  const applyCaptionLocally = useCallback((applied: AppliedCaptions) => {
    if (!applied) {
      setCapVtt(null);
      setCapLabel(null);
      setActiveSub(null);
      return;
    }
    const withId = applied.cues.map((c, i) => ({ id: i + 1, ...c }));
    const shifted = offset ? shiftCues(withId, offset) : withId;
    setCapVtt(toVtt(shifted));
    setCapLabel(applied.label);
    setActiveSub(applied.lang);
  }, [offset]);

  const applySubtitleLanguage = useCallback(
    async (lang: SubLang | null) => {
      setSubError(null);
      if (subStatusTimer.current) clearTimeout(subStatusTimer.current);
      setMobileMenuOpen(null);

      if (!lang) {
        applyCaptionLocally(null);
        onCaptionsChange?.(null);
        setSubStatus(null);
        return;
      }
      if (!englishUrl) {
        setSubStatus({ kind: "error", text: "Subtitles unavailable" });
        subStatusTimer.current = setTimeout(() => setSubStatus(null), 2000);
        return;
      }

      const cached = subCache.current.get(lang.code);
      if (cached) {
        applyCaptionLocally(cached);
        onCaptionsChange?.(cached);
        setSubStatus({ kind: "complete", text: `${cached.label} subtitles ready` });
        subStatusTimer.current = setTimeout(() => setSubStatus(null), 2000);
        return;
      }

      // Progressive translation: English (original) captions load first and
      // stay on screen; each translated cue window is painted as it arrives.
      setSubBusy(lang.code);
      setSubStatus({ kind: "waiting", text: `Translating to ${lang.label}…` });
      try {
        const enRes = await fetch(`/api/stream/subtitle?url=${encodeURIComponent(englishUrl)}`);
        if (!enRes.ok) throw new Error("Could not load English captions");
        const srcCues = parseVtt(await enRes.text());

        if (lang.code === "en") {
          const applied: AppliedCaptions = { lang: "en", label: lang.label, cues: srcCues };
          subCache.current.set("en", applied);
          applyCaptionLocally(applied);
          onCaptionsChange?.(applied);
          setSubStatus({ kind: "complete", text: "English subtitles" });
          subStatusTimer.current = setTimeout(() => setSubStatus(null), 2000);
          return;
        }

        const CHUNK = 40;
        const CONC = 2;
        const byStart = new Map<number, { id: number; start: number; end: number; text: string }>();
        let done = 0;
        let next = 0;
        let failed: string | null = null;

        const worker = async () => {
          while (next < srcCues.length && !failed) {
            const chunk = srcCues.slice(next, next + CHUNK);
            next += CHUNK;
            const t0 = Math.max(0, chunk[0].start - 0.05);
            const t1 = chunk[chunk.length - 1].end + 0.05;
            const params = new URLSearchParams({
              url: englishUrl,
              lang: lang.code,
              animeId: String(animeId),
              ep: String(ep),
              sessionId: getSessionId(),
              t0: String(t0),
              t1: String(t1),
            });
            const res = await fetch(`/api/stream/subtitle/translate?${params.toString()}`).catch(() => null);
            if (!res || !res.ok) {
              // Surface the server's reason (quota exhausted, provider down, …)
              // instead of a bare status code.
              let detail = "";
              if (res) {
                try {
                  const body = (await res.json()) as { error?: string; code?: string };
                  detail = body.error || body.code || "";
                } catch {
                  /* non-JSON error body */
                }
              }
              failed = detail
                ? `${detail} (${res?.status ?? "network"})`
                : res
                  ? `Translation failed (${res.status})`
                  : "Translation request failed";
              return;
            }
            let cues: ReturnType<typeof parseVtt> = [];
            try {
              cues = parseVtt(await res.text());
            } catch {
              failed = "Malformed translation response";
              return;
            }
            for (const c of cues) byStart.set(Number(c.start.toFixed(3)), c);
            done += chunk.length;

            const merged = srcCues
              .map((c) => {
                const hit = byStart.get(Number(c.start.toFixed(3)));
                return hit ? { id: c.id, start: c.start, end: c.end, text: hit.text } : null;
              })
              .filter((c): c is { id: number; start: number; end: number; text: string } => c !== null);
            if (merged.length) {
              const applied: AppliedCaptions = { lang: lang.code, label: lang.label, cues: merged };
              applyCaptionLocally(applied);
            }
            setSubStatus({
              kind: "waiting",
              text: `Translating to ${lang.label}… ${Math.min(done, srcCues.length)}/${srcCues.length}`,
            });
          }
        };

        await Promise.all(Array.from({ length: CONC }, () => worker()));

        if (failed) throw new Error(failed);

        const mergedAll = srcCues
          .map((c) => {
            const hit = byStart.get(Number(c.start.toFixed(3)));
            return hit ? { id: c.id, start: c.start, end: c.end, text: hit.text } : null;
          })
          .filter((c): c is { id: number; start: number; end: number; text: string } => c !== null);

        const applied: AppliedCaptions = {
          lang: lang.code,
          label: lang.label,
          cues: mergedAll.length ? mergedAll : srcCues,
        };
        subCache.current.set(lang.code, applied);
        applyCaptionLocally(applied);
        onCaptionsChange?.(applied);
        setSubStatus({ kind: "complete", text: `${lang.label} subtitles ready` });
        subStatusTimer.current = setTimeout(() => setSubStatus(null), 2000);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Translation failed";
        setSubError(msg);
        setSubStatus({ kind: "error", text: msg });
        subStatusTimer.current = setTimeout(() => setSubStatus(null), 2500);
      } finally {
        setSubBusy(null);
      }
    },
    [animeId, applyCaptionLocally, ep, englishUrl, offset, onCaptionsChange],
  );

  const handleCast = async () => {
    const el = video.current as any;
    if (!el) return;
    const absoluteSrc = (() => {
      try { return new URL(src, window.location.origin).toString(); } catch { return src; }
    })();
    try {
      const w = window as any;
      if (w.cast?.framework && w.chrome?.cast?.media) {
        const ctx = w.cast.framework.CastContext.getInstance();
        await ctx.requestSession();
        const session = ctx.getCurrentSession();
        if (session) {
          const contentType = /\.mp4($|\?)/i.test(absoluteSrc) || progressive ? "video/mp4" : "application/x-mpegURL";
          const mediaInfo = new w.chrome.cast.media.MediaInfo(absoluteSrc, contentType);
          mediaInfo.streamType = w.chrome.cast.media.StreamType.BUFFERED;
          mediaInfo.metadata = new w.chrome.cast.media.GenericMediaMetadata();
          mediaInfo.metadata.title = title || `Episode ${ep}`;
          const request = new w.chrome.cast.media.LoadRequest(mediaInfo);
          await session.loadMedia(request);
          return;
        }
      }
      if (el.remote?.watchAvailability) {
        try {
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const id = el.remote.watchAvailability((available: boolean) => {
              if (available && !settled) {
                settled = true;
                try { el.remote.cancelWatchAvailability?.(id); } catch {}
                resolve();
              }
            });
            setTimeout(() => { if (!settled) { settled = true; try { el.remote.cancelWatchAvailability?.(id); } catch {} reject(new Error("no-remote")); } }, 2500);
          });
        } catch {}
      }
      if (el.remote?.prompt) {
        await el.remote.prompt();
        return;
      }
      if (el.webkitShowPlaybackTargetPicker) {
        el.webkitShowPlaybackTargetPicker();
        return;
      }
      if ((navigator as any).presentation?.requestPresent) {
        await (navigator as any).presentation.requestPresent(absoluteSrc);
        return;
      }
      alert("Cast is not available on this browser/device. Use Chrome with a Chromecast/Smart TV on the same network, or AirPlay on Safari.");
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (/cancel/i.test(msg)) return;
      alert("Could not start cast. Make sure TV/cast device is on the same Wi‑Fi and try again.");
    }
  };

  const togglePlay = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const seekBy = (d: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + d));
  };

  const toggleFit = () => {
    setFit((f) => {
      const next = f === "contain" ? "cover" : "contain";
      sessionStorage.setItem("na_fit", next);
      return next;
    });
  };

    const qualityOptions = useMemo(() => {
    if (levels.length > 0) {
      return [
        { index: -1, label: "Auto", height: 0 },
        ...levels,
      ];
    }
    const fallbackLabels = ["360p", "480p", "720p", "1080p"];
    return [
      { index: -1, label: "Auto", height: 0 },
      ...fallbackLabels.map((label, i) => ({
        index: -(i + 2),
        label,
        height: parseInt(label),
      })),
    ];
   }, [levels]);

  /** Human label of the subtitle track that a download would produce. */
  const activeSubLang =
    captions && captions.cues.length > 0
      ? captions.label
      : capLabel && capLabel !== "English"
        ? capLabel
        : null;

    const currentQ = useMemo(() => {
     if (level < 0) return qualityOptions.length > 0 ? "Auto" : "720p";
     const l = qualityOptions.find((x) => x.index === level);
     return l ? l.label : "720p";
    }, [level, levels, qualityOptions]);

  const onKey = (e: React.KeyboardEvent) => {
    const el = video.current;
    if (!el) return;
    if (e.key === " " || e.key.toLowerCase() === "k") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowRight") seekBy(5);
    else if (e.key === "ArrowLeft") seekBy(-5);
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      setVolume(Math.min(1, volume + 0.1));
      el.volume = Math.min(1, volume + 0.1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setVolume(Math.max(0, volume - 0.1));
      el.volume = Math.max(0, volume - 0.1);
    } else if (e.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
  };

    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        container.current?.requestFullscreen?.().then(() => {
          try { (screen.orientation as any)?.lock?.("landscape").catch?.(() => {}); } catch {}
        }).catch(() => {});
      } else {
        try { (screen.orientation as any)?.unlock?.(); } catch {}
        document.exitFullscreen().catch(() => {});
      }
    };

    const toggleFitMode = () => {
      setFit((f) => {
        const next = f === "cover" ? "contain" : "cover";
        sessionStorage.setItem("na_fit", next);
        return next;
      });
    };

    const progress = duration > 0 ? (current / duration) * 100 : 0;

    const episodeList = useMemo(() => {
      if (!epTotal || epTotal <= 0) return [ep];
      const total = Math.min(epTotal, 2000);
      return Array.from({ length: total }, (_, i) => i + 1);
    }, [ep, epTotal]);

    const filteredSubLangs = useMemo(() => {
      const list = subLangs ?? [];
      if (!subFilter) return list;
      const q = subFilter.toLowerCase();
      return list.filter(
        (l) =>
          l.label.toLowerCase().includes(q) ||
          l.native?.toLowerCase().includes(q) ||
          l.code.toLowerCase().includes(q),
      );
    }, [subLangs, subFilter]);

    const downloadTitle = title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    const safeTitle = downloadTitle || `anime-${animeId}`;
    const epTitle = `${safeTitle}-ep${ep}`;

    const handleDownload = async (qualityHint?: number) => {
      const isMp4 = progressive && /\.mp4/i.test(src);
      const ext = isMp4 ? "mp4" : "ts";
      const videoName = `${epTitle}.${ext}`;

      try {
        if (isMp4) {
          const a = document.createElement("a");
          a.href = src;
          a.download = videoName;
          a.rel = "noopener";
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else {
          let originalUrl = src;
          let originalRef = "";
          try {
            const proxyUrl = new URL(src, window.location.origin);
            const inner = proxyUrl.searchParams.get("url");
            if (inner) originalUrl = decodeURIComponent(inner);
            originalRef = proxyUrl.searchParams.get("ref") || "";
          } catch {}

          const params = new URLSearchParams({ url: originalUrl, title: epTitle });
          if (originalRef) params.set("ref", originalRef);
          if (qualityHint && qualityHint > 0) params.set("quality", String(qualityHint));
          window.location.href = `/api/stream/download?${params.toString()}`;
        }
      } catch {
        // ignore download trigger errors
      }

      // Subtitles: always download exactly what is on screen.
      let subUrl: string | null = null;
      let subName = "subtitles";

      if (capVtt) {
        subUrl = URL.createObjectURL(new Blob([capVtt], { type: "text/vtt" }));
        const lang =
          captions && captions.cues.length > 0
            ? captions.lang || captions.label
            : (capLabel ?? "english");
        subName = `sub-${lang.toLowerCase()}`;
      } else if (captions && captions.cues.length > 0) {
        const vtt = toVtt(captions.cues.map((c, i) => ({ id: i + 1, ...c })));
        subUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
        subName = `sub-${(captions.lang || captions.label).toLowerCase()}`;
      } else if (englishUrl) {
        subUrl = englishUrl;
        subName = "sub-english";
      }

      if (subUrl) {
        const subA = document.createElement("a");
        subA.href = subUrl;
        subA.download = `${epTitle}-${subName}.vtt`;
        subA.style.display = "none";
        document.body.appendChild(subA);
        subA.click();
        document.body.removeChild(subA);
        if (subUrl.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(subUrl!), 1000);
      }
  };

  return (
    <div
      ref={container}
      className={cn("absolute inset-0", controlsOn ? "cursor-default" : "cursor-none")}
      onMouseMove={poke}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={toggleFullscreen}
      tabIndex={0}
      onKeyDown={onKey}
    >
      <video
        ref={video}
        className="h-full w-full bg-black"
        style={{ objectFit: fit }}
        playsInline
        crossOrigin="anonymous"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          const el = e.currentTarget;
          try {
            if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
          } catch {}
        }}
        onClick={togglePlay}
        muted={muted}
      />

      {fatal && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/80 p-6 text-center text-sm text-zinc-300">
          <div>
            <p>{fatal}</p>
            <button
              onClick={() => {
                setFatal(null);
                hlsRef.current?.startLoad();
              }}
              className="mt-4 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-5 py-2 text-xs font-bold"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Center state */}
      {!fatal && (!playing || waiting) && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 z-20 grid place-items-center"
          aria-label={playing ? "Buffering" : "Play"}
        >
          <span className={cn(
            "grid place-items-center rounded-full bg-black/45 text-white backdrop-blur-md ring-1 ring-white/15 transition-transform active:scale-95",
            waiting && playing ? "h-14 w-14" : "h-16 w-16 sm:h-20 sm:w-20",
          )}>
            {waiting ? (
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/25 border-t-white sm:h-8 sm:w-8" />
            ) : (
              <Play className="ml-1 h-8 w-8 fill-white text-white sm:h-9 sm:w-9" />
            )}
          </span>
        </button>
      )}

      {subStatus && (
        <div className="pointer-events-none absolute right-2 top-14 z-40 sm:right-3 sm:top-16">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-lg backdrop-blur-md",
              subStatus.kind === "waiting" && "border-white/10 bg-black/70 text-white",
              subStatus.kind === "complete" && "border-emerald-500/30 bg-emerald-950/70 text-emerald-200",
              subStatus.kind === "error" && "border-red-500/30 bg-red-950/70 text-red-200",
            )}
          >
            {subStatus.kind === "waiting" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {subStatus.kind === "complete" && <Check className="h-3.5 w-3.5" />}
            <span>{subStatus.text}</span>
          </div>
        </div>
      )}

      {/* Top-right controls overlay */}
      <div
        className={cn(
          "absolute top-2 right-2 z-30 flex items-center gap-1.5 transition-opacity duration-300 sm:top-3 sm:right-3 sm:gap-2",
          controlsOn || !playing ? "opacity-100" : "opacity-0",
        )}
      >
        <button
          onClick={() => {
            setSubFilter("");
            setSubError(null);
            setMobileMenuOpen("episodes");
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md ring-1 ring-white/10 active:scale-95 sm:h-10 sm:w-10"
          title="Episodes"
          aria-label="Episodes"
        >
          <Menu className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <button
          onClick={() => { handleDownload(); }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md ring-1 ring-white/10 active:scale-95 sm:h-10 sm:w-10"
          title="Download"
          aria-label="Download"
        >
          <Download className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <button
          onClick={() => { handleCast(); }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md ring-1 ring-white/10 active:scale-95 sm:h-10 sm:w-10"
          title="Cast"
          aria-label="Cast"
        >
          <Cast className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <button
          onClick={() => {
            loadSubtitleLanguages();
            setSubFilter("");
            setSubError(null);
            setMobileMenuOpen("subtitles");
          }}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-full bg-black/45 px-2.5 text-white backdrop-blur-md ring-1 ring-white/10 active:scale-95 sm:h-10 sm:px-3",
            (captions?.label || capLabel) && "text-[#ffb86b]",
          )}
          title="Subtitles"
          aria-label="Subtitles"
        >
          <Captions className="h-4 w-4 sm:h-5 sm:w-5" />
          <span className="max-w-[72px] truncate text-[10px] font-bold sm:max-w-[110px] sm:text-[11px]">
            {captions?.label ?? capLabel ?? "CC"}
          </span>
        </button>
      </div>

      {/* Bottom sheet / modal for episodes & subtitles */}
      {mobileMenuOpen && (mobileMenuOpen === "episodes" || mobileMenuOpen === "subtitles") && (
        <div
          className="fixed inset-0 z-[9999]"
          onClick={() => setMobileMenuOpen(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" />
          <div
            className={cn(
              "absolute overflow-hidden border-white/10 bg-[#111]/95 shadow-2xl backdrop-blur-xl",
              "inset-x-0 bottom-0 max-h-[78vh] rounded-t-2xl border-t p-4 pb-6",
              "sm:inset-auto sm:right-3 sm:top-14 sm:bottom-auto sm:max-h-[70vh] sm:w-[360px] sm:rounded-2xl sm:border sm:p-4",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                {mobileMenuOpen === "subtitles" ? "Subtitles" : "Episodes"}
              </h3>
              <button
                onClick={() => setMobileMenuOpen(null)}
                className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:bg-white/5 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {mobileMenuOpen === "subtitles" && (
              <div className="flex max-h-[62vh] flex-col">
                {!englishUrl ? (
                  <p className="text-xs text-zinc-500">Subtitles not available for this source.</p>
                ) : (
                  <>
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <Search className="h-3.5 w-3.5 text-zinc-500" />
                      <input
                        value={subFilter}
                        onChange={(e) => setSubFilter(e.target.value)}
                        placeholder="Search language…"
                        className="w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
                      />
                    </div>
                    {subError && <p className="mb-2 text-xs text-red-400">{subError}</p>}
                    {subBusy && (
                      <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#ff8a00]/30 bg-[#ff8a00]/10 px-3 py-2 text-xs text-[#ffb86b]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Translating subtitles…
                      </div>
                    )}
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                      <button
                        onClick={() => applySubtitleLanguage(null)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-semibold",
                          !captions ? "text-[#ffb86b] bg-white/5" : "text-zinc-300 hover:bg-white/5",
                        )}
                      >
                        Off
                        {!captions && <Check className="h-4 w-4" />}
                      </button>
                      {!subLangs && (
                        <div className="px-3 py-2 text-xs text-zinc-500">Loading languages…</div>
                      )}
                      {(filteredSubLangs.length ? filteredSubLangs : [{ code: "en", label: "English" }]).map((l) => (
                        <button
                          key={l.code}
                          onClick={() => applySubtitleLanguage(l)}
                          disabled={subBusy !== null}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/5 disabled:opacity-60",
                            (activeSub === l.code || captions?.lang === l.code) ? "bg-white/5 text-[#ffb86b]" : "text-zinc-200",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Globe className="h-3.5 w-3.5 shrink-0 opacity-60" />
                            <span className="truncate">{l.label}</span>
                            {l.native && l.native !== l.label && <span className="truncate text-zinc-500">{l.native}</span>}
                          </span>
                          {(activeSub === l.code || captions?.lang === l.code) && <Check className="h-4 w-4 shrink-0" />}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-zinc-500">Tap a language to translate & show subtitles.</p>
                  </>
                )}
              </div>
            )}

            {mobileMenuOpen === "episodes" && (
              <div className="max-h-[62vh] overflow-y-auto overscroll-contain">
                {episodeList.length <= 1 && !epTotal ? (
                  <p className="text-xs text-zinc-500">Episode list not available.</p>
                ) : (
                  <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
                    {episodeList.map((n) => {
                      const isCurrent = n === ep;
                      return (
                        <Link
                          key={n}
                          href={`/watch/${animeId}/${n}`}
                          onClick={() => setMobileMenuOpen(null)}
                          className={cn(
                            "flex h-10 items-center justify-center rounded-lg border text-xs font-bold",
                            isCurrent
                              ? "border-[#ff8a00] bg-gradient-to-br from-[#ff8a00] to-[#ff3d5a] text-white"
                              : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-[#ff8a00]/50 hover:text-white",
                          )}
                        >
                          {n}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {fatal && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/80 p-6 text-center text-sm text-zinc-300">
          <div>
            <p>{fatal}</p>
            <button
              onClick={() => {
                setFatal(null);
                hlsRef.current?.startLoad();
              }}
              className="mt-4 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-5 py-2 text-xs font-bold"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Center state (play button overlay) */}
      {!playing && !fatal && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 z-20 grid place-items-center"
          aria-label="Play"
        >
          <span className="grid h-20 w-20 place-items-center rounded-full bg-black/50 backdrop-blur transition-transform hover:scale-110">
            {waiting ? (
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Play className="ml-1 h-9 w-9 fill-white text-white" />
            )}
          </span>
        </button>
      )}

      {/* Bottom controls */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-2 pb-2 pt-14 transition-opacity duration-300 sm:px-4 sm:pb-2.5 sm:pt-12",
          controlsOn || !playing ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {/* Seek bar */}
        <div className="group/seek relative mb-1.5 h-5 cursor-pointer sm:mb-2">
          <div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 overflow-hidden rounded-full bg-white/20 sm:h-1">
            <div
              className="h-full bg-white/30"
              style={{ width: `${duration > 0 ? (buffered / duration) * 100 : 0}%` }}
            />
            <div
              className="absolute inset-y-0 rounded-full bg-[#ff3b3b]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-[#ff3b3b]/40"
            style={{ left: `calc(${progress}% - 7px)` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            onChange={(e) => {
              const el = video.current;
              if (el) el.currentTime = Number(e.target.value);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Seek"
          />
        </div>

        {/* Bottom row */}
        <div className="flex items-center gap-0.5 sm:gap-2">
          <button onClick={togglePlay} className="grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10 active:scale-95" aria-label={playing ? "Pause" : "Play"}>
            {playing ? (
              <Pause className="h-6 w-6 fill-white sm:h-5 sm:w-5" />
            ) : (
              <Play className="ml-0.5 h-6 w-6 fill-white sm:h-5 sm:w-5" />
            )}
          </button>

          <button
            onClick={() => setMuted((m) => !m)}
            className="grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10 active:scale-95"
            aria-label="Mute"
            title="Toggle mute"
          >
            {muted || volume === 0 ? (
              <VolumeX className="h-5 w-5" />
            ) : (
              <Volume2 className="h-5 w-5" />
            )}
          </button>

          <span className="ml-0.5 select-none text-[11px] font-semibold tabular-nums text-white/90 sm:ml-1 sm:text-[11px]">
            {fmt(current)} <span className="text-white/50">/ {fmt(duration)}</span>
          </span>

          {/* Captions / Fullscreen on mobile; Quality / Download / Fit on desktop only (mobile uses top-right overlay) */}
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {/* Captions / translate */}
            <div className="flex items-center gap-1 rounded-full bg-white/5 p-0.5">
              <button
                className={cn("ctl !h-9 !w-9", capLabel && "text-[#ffb86b]")}
                title={capLabel ? `Captions: ${capLabel}` : "Captions off"}
                onClick={() => {
                  if (capLabel) {
                    setCapVtt(null);
                    setCapLabel(null);
                    onCaptionsChange?.(null);
                  } else if (englishUrl) {
                    loadEnglish()
                      .then((vtt) => {
                        if (vtt) {
                          setCapVtt(vtt);
                          setCapLabel("English");
                        }
                      })
                      .catch(() => {});
                  }
                }}
                aria-label="Toggle captions"
              >
                <Captions className="h-4 w-4" />
              </button>
            </div>

            {/* Quality (desktop only) */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setQualityMenu((v) => !v)}
                className="flex items-center gap-1 rounded-full px-2.5 py-2 text-[11px] font-bold text-zinc-200 transition-colors hover:bg-white/10 sm:gap-1.5 sm:px-3"
                title="Quality"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {currentQ}
              </button>
              {qualityMenu && (
                <div className="glass absolute bottom-11 right-0 z-40 w-28 overflow-hidden rounded-xl border border-white/10 py-1 shadow-2xl">
                  {qualityOptions.map((l) => (
                    <button
                      key={l.index}
                      onClick={() => {
                        if (levels.length > 0 && l.index >= 0 && l.index < levels.length) {
                          setLevel(l.index);
                          hlsRef.current && (hlsRef.current.currentLevel = l.index);
                        } else if (levels.length > 0 && l.index === -1) {
                          setLevel(-1);
                          hlsRef.current && (hlsRef.current.currentLevel = -1);
                        } else {
                          setLevel(l.index);
                        }
                        setQualityMenu(false);
                      }}
                      className={cn(
                        "block w-full px-3 py-1.5 text-left text-[11px] font-semibold",
                        level === l.index ? "text-[#ffb86b]" : "text-zinc-300 hover:bg-white/5",
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Download (desktop only) */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => {
                  if (levels.length > 0) setDownloadMenu((v) => !v);
                  else handleDownload();
                }}
                className="ctl"
                title="Download video + subtitles"
                aria-label="Download"
              >
                <Download className="h-4 w-4" />
              </button>
              {downloadMenu && levels.length > 0 && (
                <div className="glass absolute bottom-11 right-0 z-40 w-32 overflow-hidden rounded-xl border border-white/10 py-1 shadow-2xl">
                  <button
                    onClick={() => {
                      handleDownload();
                      setDownloadMenu(false);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-[11px] font-semibold text-zinc-300 hover:bg-white/5"
                  >
                    Auto (highest)
                  </button>
                  {levels.map((l) => (
                    <button
                      key={l.index}
                      onClick={() => {
                        handleDownload(l.height);
                        setDownloadMenu(false);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-[11px] font-semibold text-zinc-300 hover:bg-white/5"
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fit (desktop only) */}
            <button
              onClick={toggleFitMode}
              className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-bold text-zinc-200 transition-colors hover:bg-white/10 sm:flex"
              title={fit === "contain" ? "Fill screen (cover)" : "Fit screen (contain)"}
            >
              <MonitorPlay className="h-3.5 w-3.5" />
              {fit === "contain" ? "Fit" : "Fill"}
            </button>

            <button onClick={toggleFullscreen} className="ctl" aria-label="Fullscreen">
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {!ready && <div className="absolute inset-0 bg-black" />}
    </div>
  );
}
