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
        className={`grid h-8 w-8 place-items-center rounded-lg ${bg} ring-1 ${
          isDark ? "ring-brand-ink/10" : "ring-white/15"
        }`}
      >
        <span className={`text-[13px] font-medium leading-none ${text}`}>
          S<span className={accent}>·</span>L
        </span>
      </span>
      <span className="flex flex-col leading-tight">
        <span
          className={`text-base font-medium ${
            isDark ? "text-brand-navy" : "text-white"
          }`}
        >
          Shrymp
        </span>
        <span
          className={`text-xs font-medium ${
            isDark ? "text-brand-navy/50" : "text-white/60"
          }`}
        >
          Logistics
        </span>
      </span>
    </span>
  );
}
