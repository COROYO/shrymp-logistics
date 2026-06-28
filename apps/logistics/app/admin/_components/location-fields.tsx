"use client";

export type LocationOption = {
  id: string;
  name: string;
  isPrimary: boolean;
};

export function LocationSelect({
  locations,
  value,
  onChange,
  name = "locationId",
  required = true,
  className = "",
}: {
  locations: LocationOption[];
  value: string;
  onChange: (id: string) => void;
  name?: string;
  required?: boolean;
  className?: string;
}) {
  if (locations.length === 0) {
    return (
      <p className="text-xs text-amber-700">
        Keine Standorte — bitte unter Einstellungen → Standorte syncen.
      </p>
    );
  }

  return (
    <select
      name={name}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm ${className}`}
    >
      {locations.map((loc) => (
        <option key={loc.id} value={loc.id}>
          {loc.name}
          {loc.isPrimary ? " (Shopify Primary)" : ""}
        </option>
      ))}
    </select>
  );
}

export function LocationStockBreakdown({
  rows,
}: {
  rows: Array<{ locationId: string; locationName: string; onHand: number }>;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {rows.map((row, idx) => (
        <span
          key={`${row.locationId}-${idx}`}
          className="inline-flex items-center gap-1 rounded-md bg-brand-cream/60 px-2 py-0.5 text-[10px] font-semibold text-brand-navy/80"
        >
          <span>{row.locationName}</span>
          <span className="tabular-nums text-brand-navy">{row.onHand}</span>
        </span>
      ))}
    </div>
  );
}
