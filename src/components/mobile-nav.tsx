"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Compass, Home, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { href: "/discover/trending", label: "Discover", icon: Compass, match: (p: string) => p.startsWith("/discover") || p.startsWith("/genre") || p.startsWith("/type") },
  { href: "/search", label: "Search", icon: Search, match: (p: string) => p.startsWith("/search") },
  { href: "/library", label: "Library", icon: Bookmark, match: (p: string) => p.startsWith("/library") },
];

export default function MobileNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/watch")) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#0b0716]/95 backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid h-[64px] max-w-lg grid-cols-4 px-2 pb-[max(env(safe-area-inset-bottom),0px)]">
        {items.map((it) => {
          const active = it.match(pathname);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold transition-colors",
                active ? "text-[#ffb86b]" : "text-zinc-500",
              )}
            >
              <span
                className={cn(
                  "grid h-8 w-12 place-items-center rounded-full",
                  active && "bg-[#ff8a00]/15",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "fill-[#ff8a00]/20")} />
              </span>
              <span>{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
