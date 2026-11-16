"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  Languages,
  Menu,
  Search,
  X,
} from "lucide-react";
import { GENRES, FORMATS } from "@/lib/anime-constants";
import { browserSuggest } from "@/lib/anilist-client";
import { cn } from "@/lib/utils";
import AnimeImage from "./anime-image";
import { useLang } from "./providers";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/discover/updated", label: "Updated" },
  { href: "/discover/added", label: "Added" },
  { href: "/discover/popular", label: "Popular" },
  { href: "/discover/upcoming", label: "Upcoming" },
  { href: "/discover/ongoing", label: "Ongoing" },
  { href: "/discover/complete", label: "Complete" },
  { href: "/random", label: "Random" },
];

type Suggestion = {
  id: number;
  title: { romaji: string | null; english: string | null };
  coverImage: { large: string | null; color: string | null };
  format: string | null;
  seasonYear: number | null;
  averageScore: number | null;
};

function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5">
      <img src="/logo1.png" alt="AHSANIME" className="lg:w-[80%] h-[40px] relative rounded-xl transition-transform duration-300 group-hover:scale-105" />
    </Link>
  );
}

function SearchBox({ mobile = false }: { mobile?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Suggestion[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { pick } = useLang();

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        let list: Suggestion[] = [];
        try {
          if (res.ok) list = ((await res.json()).results ?? []) as Suggestion[];
        } catch {
          list = [];
        }
        if (!list.length) {
          // Server quota over (or disguised empty) → ask AniList directly
          // from THIS browser: visitor's own IP/quota (MangaYomi model).
          try {
            const direct = await browserSuggest(q.trim());
            list = direct.map((d) => ({
              id: d.id,
              title: d.title,
              coverImage: d.coverImage,
              format: d.format,
              seasonYear: d.seasonYear,
              averageScore: d.averageScore,
            }));
          } catch {
            /* keep server result */
          }
        }
        setResults(list);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div ref={boxRef} className={cn("relative", mobile ? "w-full" : "w-56 xl:w-64")}>
      <form onSubmit={submit}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search anime..."
          className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none transition-all duration-300 focus:border-[#ff8a00]/60 focus:bg-white/10 focus:ring-2 focus:ring-[#ff8a00]/20"
        />
      </form>

      {open && (results.length > 0 || loading) && (
        <div className="glass absolute left-0 right-0 top-11 z-50 w-full min-w-[260px] max-w-[320px] overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/60 animate-fade-up">
          {loading && (
            <div className="p-3 text-xs text-zinc-500">Searching…</div>
          )}
          {!loading &&
            results.map((r) => (
              <Link
                key={r.id}
                href={`/anime/${r.id}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 border-b border-white/5 p-2.5 transition-colors hover:bg-white/5"
              >
                <AnimeImage
                  src={r.coverImage?.large}
                  alt={pick(r.title)}
                  className="h-12 w-9 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-zinc-100">
                    {pick(r.title)}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                    {r.format ?? "—"} • {r.seasonYear ?? "TBA"}
                    {r.averageScore ? ` • ★ ${(r.averageScore / 10).toFixed(1)}` : ""}
                  </p>
                </div>
              </Link>
            ))}
          {!loading && (
            <button
              onClick={submit}
              className="w-full bg-[#ff8a00]/10 px-3 py-2.5 text-left text-[11px] font-semibold text-[#ffb86b] transition-colors hover:bg-[#ff8a00]/20"
            >
              View all results for “{q}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DropMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium text-zinc-400 transition-colors hover:text-white"
      >
        {label}
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
        />
      </button>
      <div
        className={cn(
          "glass absolute left-0 top-full z-50 origin-top rounded-2xl border border-white/10 p-2 shadow-2xl shadow-black/50 transition-all duration-200",
          open
            ? "pointer-events-auto translate-y-1 opacity-100"
            : "pointer-events-none -translate-y-0 opacity-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}

type ReactNode = import("react").ReactNode;

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { lang, toggle } = useLang();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <header className="glass sticky top-0 z-40 border-b border-white/5">
      <div className="shell flex h-14 items-center gap-2 sm:h-16 sm:gap-3">
        <Logo />

        {/* Desktop menu */}
        <nav className="ml-4 hidden items-center gap-0.5 lg:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                pathname === l.href
                  ? "bg-[#ff8a00]/15 text-[#ffb86b]"
                  : "text-zinc-400 hover:text-white",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {/* Search: desktop row only / mobile opens the menu panel */}
          <div className="hidden lg:block">
            <SearchBox />
          </div>

          <Link
            href="/library"
            title="My Watchlist"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition-all hover:border-[#ff8a00]/50 hover:text-[#ffb86b]"
          >
            <Bookmark className="h-4 w-4" />
          </Link>

          {/* Mobile: search + menu open the panel (which holds the search box) */}
          <button
            onClick={() => { setSearchOpen((v) => !v); setMobileOpen(false); }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition-all hover:border-[#ff8a00]/50 hover:text-[#ffb86b] lg:hidden"
            aria-label="Search anime"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            onClick={() => { setMobileOpen((v) => !v); setSearchOpen(false); }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-300 lg:hidden"
            aria-label="Menu"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Search-only panel (mobile) */}
      {searchOpen && (
        <div className="border-t border-white/5 px-4 py-3 lg:hidden animate-fade-in">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <SearchBox mobile />
            </div>
            <button
              onClick={() => setSearchOpen(false)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition-all hover:border-[#ff8a00]/50 hover:text-[#ffb86b]"
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Mobile panel */}
      {mobileOpen && (
        <div className="max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-white/5 px-4 pb-6 pt-3 lg:hidden animate-fade-in">
          <div className="mb-4 flex items-center gap-2 lg:hidden">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Language</span>
            <button
              onClick={toggle}
              title="Toggle English / Romaji titles"
              className="flex items-center gap-0.5 overflow-hidden rounded-full border border-white/10 bg-white/5 p-0.5 text-[9px] font-bold tracking-wide transition-colors hover:border-[#ff8a00]/50 sm:gap-1.5 sm:text-[10px]"
            >
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 transition-all duration-300",
                  lang === "en"
                    ? "bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] text-white shadow"
                    : "text-zinc-500",
                )}
              >
                ENG
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 transition-all duration-300",
                  lang === "jp"
                    ? "bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] text-white shadow"
                    : "text-zinc-500",
                )}
              >
                日本
              </span>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-xl px-3 py-2.5 text-sm font-medium",
                  pathname === l.href
                    ? "bg-[#ff8a00]/15 text-[#ffb86b]"
                    : "bg-white/5 text-zinc-300",
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                <Languages className="h-3 w-3" /> Genre
              </p>
              <div className="flex flex-wrap gap-1">
                {GENRES.map((g) => (
                  <Link
                    key={g}
                    href={`/genre/${encodeURIComponent(g)}`}
                    className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-zinc-400"
                  >
                    {g}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                Type
              </p>
              <div className="flex flex-col gap-1">
                {FORMATS.map((f) => (
                  <Link
                    key={f.value}
                    href={`/type/${f.value.toLowerCase()}`}
                    className="text-xs text-zinc-400"
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
