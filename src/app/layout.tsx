import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/components/providers";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import AutoRefresh from "@/components/auto-refresh";
import MobileNav from "@/components/mobile-nav";
import SWRegister from "@/components/sw-register";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "AHSANIME — Watch Anime Online",
    template: "%s | AHSANIME",
  },
  description:
    "AHSANIME — discover and stream anime in HD. Trending, popular, upcoming, ongoing and completed anime with a premium ad-free interface.",
  keywords: ["anime", "streaming", "watch anime", "anilist", "ahsanime"],
  verification: {
    google: "-BD_PRi36Bw9HqSJZh7zmOhmR1xVvBvSMM9XRIpeemY",
    other: {
      "msvalidate.01": "76F5AAD910BB922756D179F24026E9E8",
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    siteName: "AHSANIME",
    title: "AHSANIME — Watch Anime Online",
    description:
      "Watch anime online in HD with English subtitles and dub, plus AI subtitle translation in 54 languages.",
  },
  twitter: {
    card: "summary_large_image",
    title: "AHSANIME — Watch Anime Online",
    description:
      "Watch anime online in HD with English subtitles and dub, plus AI subtitle translation in 54 languages.",
  },
};

export const viewport: Viewport = {
  themeColor: "#07070d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen bg-ink text-zinc-100 antialiased">
        <LangProvider>
          <Navbar />
          <main className="min-h-[70dvh] pb-20 lg:pb-0">{children}</main>
          <Footer />
          <MobileNav />
          <AutoRefresh />
          <SWRegister />
        </LangProvider>
      </body>
    </html>
  );
}
