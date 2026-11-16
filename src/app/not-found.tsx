import Link from "next/link";
import { Ghost, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <div className="pulse-ring grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-[#ff8a00] to-[#ff3d5a] shadow-2xl shadow-[#ff3d5a]/30">
        <Ghost className="h-9 w-9 text-white" />
      </div>
      <h1 className="font-display mt-8 text-5xl font-bold tracking-tight text-white">404</h1>
      <p className="mt-3 text-sm text-zinc-500">
        This page drifted into another dimension — like a filler episode, it doesn’t exist.
      </p>
      <Link
        href="/"
        className="mt-8 flex items-center gap-2 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-7 py-3 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95"
      >
        <Home className="h-4 w-4" /> Back to Home
      </Link>
    </div>
  );
}
