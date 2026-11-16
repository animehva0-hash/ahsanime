"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Lang = "en" | "jp";

type LangCtx = {
  lang: Lang;
  toggle: () => void;
  /** pick a display title from an AniList title object */
  pick: (t: { romaji: string | null; english: string | null }) => string;
};

const Ctx = createContext<LangCtx>({
  lang: "en",
  toggle: () => {},
  pick: (t) => t.english || t.romaji || "Unknown",
});

export function useLang() {
  return useContext(Ctx);
}

/** Ensures a stable anonymous id (localStorage + cookie) for library/history. */
export function useUid(): string | null {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    let id = localStorage.getItem("na_uid");
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("na_uid", id);
    }
    // Mirror into a cookie so API routes can read it.
    document.cookie = `na_uid=${id}; path=/; max-age=31536000; samesite=lax`;
    setUid(id);
  }, []);
  return uid;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem("na_lang");
    if (saved === "jp" || saved === "en") setLang(saved);
    // Pre-create the anonymous uid so history/watchlist work from first paint.
    if (!localStorage.getItem("na_uid")) {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("na_uid", id);
      document.cookie = `na_uid=${id}; path=/; max-age=31536000; samesite=lax`;
    }
  }, []);

  const toggle = useCallback(() => {
    setLang((prev) => {
      const next: Lang = prev === "en" ? "jp" : "en";
      localStorage.setItem("na_lang", next);
      return next;
    });
  }, []);

  const value = useMemo<LangCtx>(
    () => ({
      lang,
      toggle,
      pick: (t) =>
        (lang === "jp" ? t.romaji || t.english : t.english || t.romaji) ??
        "Unknown",
    }),
    [lang, toggle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
