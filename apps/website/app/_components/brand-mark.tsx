type BrandMarkProps = {
  variant?: "light" | "dark";
  compact?: boolean;
};

export function BrandMark({ variant = "light", compact = false }: BrandMarkProps) {
  const isDark = variant === "dark";

  return (
    <span className="flex items-center gap-2">
      <span
        className={`grid size-8 place-items-center rounded-md ring-1 ${
          isDark
            ? "bg-white/10 text-white ring-white/15"
            : "bg-white text-brand-navy ring-brand-ink/10"
        }`}
      >
        <span className="text-[15px] font-medium leading-none">
          S<span className="text-brand-burgundy">·</span>L
        </span>
      </span>
      {!compact ? (
        <span className="flex flex-col leading-none">
          <span
            className={`text-base font-medium ${isDark ? "text-white" : "text-brand-navy"}`}
          >
            Shrymp
          </span>
          <span className={`mt-1 text-xs ${isDark ? "text-stone-400" : "text-secondary"}`}>
            Logistics
          </span>
        </span>
      ) : null}
    </span>
  );
}
