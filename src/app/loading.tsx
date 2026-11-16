import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="shell">
      <div className="mt-5 h-[70dvh] min-h-[540px] rounded-[2rem] sm:h-[560px] skeleton" />
      <div className="mt-10 space-y-10">
        {[0, 1, 2].map((row) => (
          <div key={row}>
            <div className="mb-4 h-6 w-52 rounded-lg skeleton" />
            <div className="flex gap-4 overflow-hidden">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="w-36 shrink-0 sm:w-44">
                  <div className="aspect-[2/3] rounded-2xl skeleton" />
                  <div className="mt-2.5 h-3 w-3/4 rounded skeleton" />
                  <div className="mt-1.5 h-2.5 w-1/2 rounded skeleton" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Loader2 className="sr-only" />
    </div>
  );
}
