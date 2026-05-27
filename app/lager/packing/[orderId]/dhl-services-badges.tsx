import type { DhlServicesSummary } from "@/server/dhl/request-builder";

/** Format integer cents as "12,34 EUR" for display. */
export function formatMoneyCents(cents: number, currency = "EUR"): string {
  const value = (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value} ${currency}`;
}

export function DhlServicesBadges({
  services,
}: {
  services: DhlServicesSummary;
}) {
  if (!services.cod && !services.premium && !services.shippingMethodTitle) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2">
      {services.shippingMethodTitle ? (
        <p className="text-xs text-brand-navy/70">
          Versandmethode:{" "}
          <span className="font-semibold text-brand-navy">
            {services.shippingMethodTitle}
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {services.cod ? (
          <span className="chip chip-amber">
            Nachnahme
            {services.codAmountCents != null
              ? ` · ${formatMoneyCents(services.codAmountCents, services.codCurrency ?? "EUR")}`
              : " · Betrag fehlt"}
          </span>
        ) : null}
        {services.premium ? (
          <span className="chip chip-violet">Premium-Versand</span>
        ) : null}
      </div>
    </div>
  );
}
