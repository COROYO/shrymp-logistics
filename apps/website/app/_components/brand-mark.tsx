type BrandMarkProps = {
  variant?: "light" | "dark";
  compact?: boolean;
};

export function BrandMark({ variant = "light", compact = false }: BrandMarkProps) {
  const isDark = variant === "dark";
  const bg = isDark ? "bg-brand-navy" : "bg-white";
  const text = isDark ? "text-white" : "text-brand-navy";
  const accent = "text-brand-burgundy";

  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`grid h-9 w-9 place-items-center rounded-md ${bg} ring-1 ring-brand-navy/10`}
      >
        <span
          className={`font-bold leading-none tracking-tight ${text}`}
          style={{ fontSize: "15px" }}
        >
          S<span className={accent}>·</span>L
        </span>
      </span>
      {!compact ? (
        <span className="flex flex-col leading-tight">
          <span
            className={`text-[15px] font-bold uppercase tracking-[0.18em] ${
              isDark ? "text-white" : "text-brand-navy"
            }`}
          >
            Shrymp
          </span>
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.32em] ${
              isDark ? "text-brand-burgundy" : "text-brand-burgundy"
            }`}
          >
            Logistics
          </span>
        </span>
      ) : null}
    </span>
  );
}
