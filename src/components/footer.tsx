import Link from "next/link";
import { Heart } from "lucide-react";
import { GENRES } from "@/lib/anime-constants";

export default function Footer() {
  return (
    <footer className="mt-10 border-t border-white/5 bg-[#08080f] pb-20 lg:mt-20 lg:pb-0">
      <div className="shell grid gap-8 py-8 sm:py-14 md:grid-cols-[1.6fr_1fr_1fr] md:gap-10">
        <div>
          <div className="flex items-center gap-2.5">
            <img src="/logo1.png" alt="AHSANIME" className="h-[36px] rounded-xl sm:h-[40px] lg:w-[40%]" />
          </div>
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-zinc-500">
            Discover and watch anime with a clean, ad-free experience. Titles
            switch between English and Romaji with a single tap.
          </p>
          <p className="mt-6 flex items-center gap-1 text-[11px] text-zinc-600">
            Built with <Heart className="h-3 w-3 fill-[#ff3d5a] text-[#ff3d5a]" /> ·
            Data &amp; images courtesy of AniList.co
          </p>
        </div>

        <div>
          <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-500">
            Legal
          </h4>
          <ul className="space-y-2 text-xs text-zinc-400">
            <li><Link className="hover:text-[#ffb86b]" href="/dmca">DMCA Notice</Link></li>
            <li><Link className="hover:text-[#ffb86b]" href="/terms">Terms of Use</Link></li>
            <li><Link className="hover:text-[#ffb86b]" href="/contact">Contact</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-500">
            Genres
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {GENRES.slice(0, 12).map((g) => (
              <Link
                key={g}
                href={`/genre/${encodeURIComponent(g)}`}
                className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-zinc-400 transition-colors hover:border-[#ff8a00]/50 hover:text-[#ffb86b]"
              >
                {g}
              </Link>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-white/5 py-4 text-center text-[10px] tracking-wide text-zinc-600 sm:py-5">
        © {new Date().getFullYear()} — No media is hosted on this site.
      </div>
    </footer>
  );
}
