type BrandMarkProps = {
  variant?: "light" | "dark";
};

/**
 * Internal wordmark for the warehouse tool. Mirrors the IKRINKA storefront
 * vibe (navy + burgundy) without lifting their actual logo asset.
 */
export function BrandMark({ variant = "light" }: BrandMarkProps) {
  const isDark = variant === "dark";
  const bg = isDark ? "bg-brand-navy" : "bg-white";
  const text = isDark ? "text-white" : "text-brand-navy";
  const accent = "text-brand-burgundy";

  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`grid h-9 w-9 place-items-center rounded-md ${bg} ring-1 ring-white/10`}
      >
        <span
          className={`font-bold leading-none tracking-tight ${text}`}
          style={{ fontSize: "15px" }}
        >
          M<span className={accent}>·</span>L
        </span>
      </span>
      <span className="flex flex-col leading-tight">
        <span
          className={`text-[15px] font-bold uppercase tracking-[0.18em] ${
            isDark ? "text-brand-navy" : "text-white"
          }`}
        >
          Monolith
        </span>
        <span
          className={`text-[10px] font-semibold uppercase tracking-[0.32em] ${
            isDark ? "text-brand-burgundy" : "text-white/60"
          }`}
        >
          Caviar Lager
        </span>
      </span>
    </span>
  );
}
