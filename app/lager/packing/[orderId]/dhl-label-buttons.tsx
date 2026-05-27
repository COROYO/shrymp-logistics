import { buildDhlLinks } from "@/lib/dhl-links";

/**
 * Single, deterministic label button:
 *
 *   - Lieferadresse in Deutschland  → DHL Standard (EasyDHL in Shopify-Admin)
 *   - Lieferadresse außerhalb DE    → DHL Express (DHL Express Commerce)
 *
 * `country_code` is Shopify's ISO-3166 alpha-2 (e.g. "DE", "AT", "CH").
 * If null/leer behandeln wir es defensiv als Inland (Standard).
 */
export function DhlLabelButtons({
  orderId,
  shopDomain,
  countryCode,
}: {
  orderId: string;
  shopDomain: string;
  countryCode: string | null;
}) {
  const isInternational = !!countryCode && countryCode.toUpperCase() !== "DE";
  const { standard, express } = buildDhlLinks(orderId, shopDomain);
  const href = isInternational ? express : standard;
  const label = isInternational
    ? "DHL Express Etikett"
    : "DHL Standard Etikett";
  const sublabel = isInternational
    ? `Auslandsversand (${countryCode}) — DHL Express`
    : "Inlandsversand DE — DHL Standard";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition ${
          isInternational
            ? "bg-purple-600 text-white hover:bg-purple-700"
            : "bg-amber-500 text-white hover:bg-amber-600"
        }`}
      >
        {label}
        <ExternalIcon />
      </a>
      <span
        className={`text-xs font-medium ${
          isInternational ? "text-purple-700" : "text-amber-700"
        }`}
      >
        {sublabel}
      </span>
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path d="M11 3a1 1 0 1 0 0 2h2.586L8.293 10.293a1 1 0 1 0 1.414 1.414L15 6.414V9a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5Z" />
      <path d="M5 5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3a1 1 0 1 0-2 0v3H5V7h3a1 1 0 0 0 0-2H5Z" />
    </svg>
  );
}
