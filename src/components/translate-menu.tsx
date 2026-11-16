"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronUp, Globe, Loader2, Search, X } from "lucide-react";
import { getSessionId } from "@/lib/client-session";
import { parseVtt } from "@/lib/stream/vtt";
import type { CaptionCue } from "./caption-overlay";
import { cn } from "@/lib/utils";

export type LanguageEntry = { code: string; label: string; native?: string };

type LanguagesResponse = {
  ok: boolean;
  provider: string;
  model: string;
  configured: boolean;
  status: string;
  languages: LanguageEntry[];
};

export type AppliedCaptions = {
  lang: string; // "en" or target code
  label: string;
  cues: CaptionCue[];
} | null;

export default function TranslateMenu({
  englishUrl,
  animeId,
  ep,
  onApply,
  direction = "up",
}: {
  englishUrl: string | null;
  animeId: number;
  ep: number;
  onApply: (applied: AppliedCaptions) => void;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<LanguagesResponse | null>(null);
  const [filter, setFilter] = useState("");
  const [busyLang, setBusyLang] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [totalLines, setTotalLines] = useState(0);
  const [translatedLines, setTranslatedLines] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, AppliedCaptions>());
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  // Fetch catalog + provider status when first opened.
  useEffect(() => {
    if (!open || meta) return;
    fetch("/api/stream/subtitle/languages")
      .then((r) => r.json())
      .then((j: LanguagesResponse) => setMeta(j))
      .catch(() => setMeta(null));
  }, [open, meta]);

  // Fetch total lines from English subtitle when menu opens
  useEffect(() => {
    if (!open || !englishUrl || totalLines > 0) return;
    fetch(`/api/stream/subtitle?url=${encodeURIComponent(englishUrl)}`)
      .then((r) => r.text())
      .then((vtt) => {
        const cues = parseVtt(vtt);
        setTotalLines(cues.length);
      })
      .catch(() => {});
  }, [open, englishUrl, totalLines]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Reset when episode changes
  useEffect(() => {
    cache.current.clear();
    setActive(null);
    setError(null);
    setTotalLines(0);
    setTranslatedLines(0);
    onApply(null);
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    // Loading a different anime/episode removes older session entries.
    fetch(
      `/api/stream/subtitle/translate?sessionId=${getSessionId()}&animeId=${animeId}&ep=${ep}`,
      { method: "DELETE", keepalive: true },
    ).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeId, ep]);

  const languages = meta?.languages ?? [];
  const visible = filter
    ? languages.filter(
        (l) =>
          l.label.toLowerCase().includes(filter.toLowerCase()) ||
          l.native?.toLowerCase().includes(filter.toLowerCase()) ||
          l.code.toLowerCase().includes(filter.toLowerCase()),
      )
    : languages;

  const noSource = !englishUrl;

  async function applyLanguage(lang: LanguageEntry) {
    if (!englishUrl) return;
    setError(null);
    setTranslatedLines(0);

    // serve from local cache if already translated this session
    const cached = cache.current.get(lang.code);
    if (cached) {
      setActive(lang.code);
      onApply(cached);
      setOpen(false);
      return;
    }

    setBusyLang(lang.code);
    
    // Start progress simulation - update every 500ms
    progressInterval.current = setInterval(() => {
      setTranslatedLines(prev => Math.min(prev + Math.max(1, Math.floor(totalLines * 0.05)), totalLines - 1));
    }, 500);
    
    try {
      if (lang.code === "en") {
        const res = await fetch(
          `/api/stream/subtitle?url=${encodeURIComponent(englishUrl)}`,
        );
        if (!res.ok) throw new Error("Could not load English captions");
        const vtt = await res.text();
        const applied: AppliedCaptions = { lang: "en", label: lang.label, cues: parseVtt(vtt) };
        cache.current.set("en", applied);
        setActive("en");
        onApply(applied);
        setTranslatedLines(totalLines);
      } else {
        const params = new URLSearchParams({
          url: englishUrl,
          lang: lang.code,
          animeId: String(animeId),
          ep: String(ep),
          sessionId: getSessionId(),
        });
        const res = await fetch(`/api/stream/subtitle/translate?${params.toString()}`);
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? `Translation failed (${res.status})`);
        }
        const vtt = await res.text();
        const applied: AppliedCaptions = {
          lang: lang.code,
          label: lang.label,
          cues: parseVtt(vtt),
        };
        cache.current.set(lang.code, applied);
        setActive(lang.code);
        onApply(applied);
        setTranslatedLines(totalLines);
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Translation failed");
    } finally {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
      setBusyLang(null);
      setTranslatedLines(0);
    }
  }

  const turnOff = () => {
    setActive(null);
    onApply(null);
    setOpen(false);
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    setTranslatedLines(0);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-white shadow-md transition-all",
          "bg-gradient-to-r from-red-600 to-rose-600 hover:brightness-110 active:scale-95",
          direction === "up" && "shadow-red-900/40",
        )}
        title="Translate subtitles"
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Translate subtitles</span>
        <ChevronUp
          className={cn("h-3 w-3 transition-transform", open && "rotate-180", direction === "up" ? "" : "rotate-180")}
        />
      </button>

      {open && (
        <div
          className={cn(
            // Width never exceeds the viewport; height capped so the whole list
            // (plus its search field) stays reachable on phones.
            "glass absolute z-50 w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/60 animate-fade-up",
            direction === "up"
              ? "bottom-11 right-0 max-h-[min(22rem,50vh)] flex flex-col"
              : "right-0 top-11 max-h-[min(22rem,50vh)] flex flex-col",
          )}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-300">
              Select Language
            </p>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 hover:text-white sm:h-6 sm:w-6"
            >
              <X className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-zinc-500 hover:text-white" />
            </button>
          </div>

          {noSource ? (
            <div className="p-4 text-xs leading-relaxed text-zinc-500">
              No English soft-sub source is available for this episode, so
              translation is unavailable. English captions from the player itself
              still play normally.
            </div>
          ) : (
            <>
              <div className="border-b border-white/10 p-2">
                <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                  <Search className="h-3.5 w-3.5 text-zinc-500" />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search 54 languages…"
                    className="w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {busyLang && totalLines > 0 && (
                  <div className="px-4 py-2 border-b border-white/10">
                    <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                      <span>Translating: {busyLang === "en" ? "English" : busyLang}</span>
                      <span>{translatedLines} / {totalLines} lines</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] transition-all duration-300"
                        style={{ width: `${totalLines > 0 ? (translatedLines / totalLines) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
                <button
                  onClick={turnOff}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-2 text-xs text-zinc-400 transition-colors hover:bg-white/5",
                    active === null && "text-[#ffb86b]",
                  )}
                >
                  Off (player subtitles)
                  {active === null && <Check className="h-3.5 w-3.5" />}
                </button>
                {visible.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => applyLanguage(l)}
                    disabled={busyLang !== null}
                    className={cn(
                      "flex w-full items-center justify-between px-4 py-2 text-xs transition-colors hover:bg-white/5",
                      active === l.code ? "text-[#ffb86b]" : "text-zinc-300",
                      busyLang !== null && "opacity-50",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {busyLang === l.code ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Globe className="h-3 w-3 opacity-50" />
                      )}
                      {l.label}
                      {l.native && l.native !== l.label && (
                        <span className="text-zinc-600">{l.native}</span>
                      )}
                    </span>
                    {active === l.code && <Check className="h-3.5 w-3.5" />}
                  </button>
                ))}
                {visible.length === 0 && (
                  <p className="px-4 py-3 text-xs text-zinc-600">No language matches “{filter}”.</p>
                )}
              </div>

              <div className="border-t border-white/10 px-4 py-2.5 text-[10px] leading-relaxed text-zinc-600">
                {error ? (
                  <span className="text-red-400">{error}</span>
                ) : meta ? (
                  <span>
                    {meta.provider} · {meta.model} ·{" "}
                    {meta.configured ? "API key connected" : "API key missing — set GOOGLE_TRANSLATE_API_KEY on the server"}
                  </span>
                ) : (
                  "Checking configuration…"
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
