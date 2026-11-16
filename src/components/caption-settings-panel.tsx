"use client";

import { useState } from "react";
import { Palette, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CAPTION_SETTINGS,
  type CaptionSettings,
} from "@/lib/caption-settings";

const COLORS = [
  "#ffffff", "#ffe08a", "#ff8a8a", "#8affc1",
  "#8ad4ff", "#c58aff", "#ff9ecb", "#cccccc",
];

const BG_OPTIONS: { id: CaptionSettings["background"]; label: string }[] = [
  { id: "shadow", label: "Outline" },
  { id: "box", label: "Box" },
  { id: "none", label: "None" },
];

export default function CaptionSettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: CaptionSettings;
  onChange: (s: CaptionSettings) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"style" | "position">("style");

  const set = <K extends keyof CaptionSettings>(k: K, v: CaptionSettings[K]) =>
    onChange({ ...settings, [k]: v });

  return (
    <div className="glass absolute bottom-12 right-2 z-50 w-[min(19rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/60 animate-fade-up max-h-[min(24rem,55vh)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300">
          <Palette className="h-3.5 w-3.5 text-[#ffb86b]" /> Caption Style
        </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onChange(DEFAULT_CAPTION_SETTINGS)}
              title="Reset to defaults"
              className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 hover:text-white sm:h-6 sm:w-6"
            >
              <RotateCcw className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
            </button>
            <button
              onClick={onClose}
              aria-label="Close caption settings"
              className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 hover:text-white sm:h-6 sm:w-6"
            >
              <X className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            </button>
          </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10 p-1.5">
        {(["style", "position"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-[11px] font-bold capitalize transition-colors",
              tab === t ? "bg-white/15 text-white" : "text-zinc-400 hover:text-white",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3.5">
        {tab === "style" ? (
          <>
            {/* Font size */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Font Size
                </label>
                <span className="tabular-nums text-[10px] font-bold text-[#ffb86b]">
                  {Math.round(settings.size * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.6}
                max={2.2}
                step={0.05}
                value={settings.size}
                onChange={(e) => set("size", Number(e.target.value))}
                className="na-range w-full"
                aria-label="Caption font size"
              />
            </div>

            {/* Colour */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Text Colour
              </label>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => set("color", c)}
                    aria-label={`Colour ${c}`}
                    className={cn(
                      "h-7 w-7 rounded-lg border-2 transition-transform",
                      settings.color === c
                        ? "scale-110 border-[#ff8a00]"
                        : "border-white/20 hover:scale-105",
                    )}
                    style={{ background: c }}
                  />
                ))}
                <label className="relative grid h-7 w-7 cursor-pointer place-items-center rounded-lg border-2 border-white/20 hover:scale-105">
                  <input
                    type="color"
                    value={settings.color}
                    onChange={(e) => set("color", e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Custom colour"
                  />
                  <span className="text-[9px] font-bold text-zinc-400">+</span>
                </label>
              </div>
            </div>

            {/* Background */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Background
              </label>
              <div className="flex gap-1.5">
                {BG_OPTIONS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => set("background", b.id)}
                    className={cn(
                      "flex-1 rounded-lg py-1.5 text-[10px] font-bold transition-colors",
                      settings.background === b.id
                        ? "bg-[#ff8a00] text-white"
                        : "bg-white/5 text-zinc-400 hover:text-white",
                    )}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bold / Italic */}
            <div className="flex gap-1.5">
              <button
                onClick={() => set("bold", !settings.bold)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors",
                  settings.bold ? "bg-[#ff8a00] text-white" : "bg-white/5 text-zinc-400",
                )}
              >
                B
              </button>
              <button
                onClick={() => set("italic", !settings.italic)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 text-xs italic transition-colors",
                  settings.italic ? "bg-[#ff8a00] text-white" : "bg-white/5 text-zinc-400",
                )}
                style={{ fontStyle: "italic" }}
              >
                I
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Vertical position */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Vertical Position
                </label>
                <span className="tabular-nums text-[10px] font-bold text-[#ffb86b]">
                  {Math.round(settings.position)}%
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={96}
                step={1}
                value={settings.position}
                onChange={(e) => set("position", Number(e.target.value))}
                className="na-range w-full"
                aria-label="Caption vertical position"
              />
              <p className="mt-1.5 text-[9px] leading-relaxed text-zinc-600">
                Lower % moves captions up, higher % moves them toward the bottom.
              </p>
            </div>

            {/* Quick presets */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Quick Presets
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: "Top", v: 22 },
                  { label: "Middle", v: 55 },
                  { label: "Lower", v: 80 },
                  { label: "Bottom", v: 92 },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => set("position", p.v)}
                    className={cn(
                      "rounded-lg py-1.5 text-[10px] font-bold transition-colors",
                      Math.round(settings.position) === p.v
                        ? "bg-[#ff8a00] text-white"
                        : "bg-white/5 text-zinc-400 hover:text-white",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Live preview */}
            <div className="mt-1 rounded-xl border border-white/10 bg-black/70 p-3">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                Preview
              </p>
              <p
                className="text-center"
                style={{
                  color: settings.color,
                  fontWeight: settings.bold ? 800 : 500,
                  fontStyle: settings.italic ? "italic" : "normal",
                  fontSize: `calc(0.95rem * ${settings.size})`,
                  background:
                    settings.background === "box" ? "rgba(0,0,0,.62)" : "transparent",
                  padding: settings.background === "box" ? "0.15em 0.45em" : undefined,
                  borderRadius: settings.background === "box" ? "0.25em" : undefined,
                  textShadow:
                    settings.background === "shadow"
                      ? "-1.5px 0 0 #000,1.5px 0 0 #000,0 -1.5px 0 #000,0 1.5px 0 #000,0 3px 8px rgba(0,0,0,.85)"
                      : "none",
                }}
              >
                Yaar, ye subtitle aisa dikhega!
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
