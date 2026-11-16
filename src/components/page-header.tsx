export default function PageHeader({
  kicker,
  title,
  blurb,
  count,
}: {
  kicker: string;
  title: string;
  blurb?: string;
  count?: number | null;
}) {
  return (
    <div className="mb-8 mt-6 sm:mt-8">
      <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#ffb86b]">
        {kicker}
      </p>
      <h1 className="font-display mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        {title}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {blurb && <p className="max-w-xl text-sm text-zinc-500">{blurb}</p>}
        {typeof count === "number" && count > 0 && (
          <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {count.toLocaleString()} titles
          </span>
        )}
      </div>
      <div className="mt-5 h-px bg-gradient-to-r from-[#ff8a00]/60 via-[#ff3d5a]/30 to-transparent" />
    </div>
  );
}
