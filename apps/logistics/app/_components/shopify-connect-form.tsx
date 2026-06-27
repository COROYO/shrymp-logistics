"use client";

import { useState } from "react";

const inputClass =
  "mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-brand-ink shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

const labelClass =
  "block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70";

type Props = {
  initialShopDomain?: string | null;
  submitLabel?: string;
  compact?: boolean;
};

export function ShopifyConnectForm({
  initialShopDomain = "",
  submitLabel = "Mit Shopify verbinden",
  compact = false,
}: Props) {
  const [shopDomain, setShopDomain] = useState(initialShopDomain ?? "");
  const [error, setError] = useState<string | null>(null);

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = shopDomain.trim();
    if (!trimmed) {
      setError("Bitte Shop-Domain eingeben.");
      return;
    }
    const params = new URLSearchParams({ shop: trimmed });
    window.location.href = `/api/shopify/install?${params.toString()}`;
  }

  return (
    <form onSubmit={handleConnect} className={compact ? "space-y-3" : "space-y-5"}>
      <div>
        <label htmlFor="shopDomain" className={labelClass}>
          Shopify-Shop
        </label>
        <input
          id="shopDomain"
          name="shopDomain"
          type="text"
          required
          placeholder="mein-shop oder mein-shop.myshopify.com"
          value={shopDomain}
          onChange={(e) => setShopDomain(e.target.value)}
          className={inputClass}
        />
        {!compact ? (
          <p className="mt-1.5 text-xs text-brand-navy/55">
            Du wirst zu Shopify weitergeleitet und gibst dort nur die App-Freigabe
            — keine API-Keys nötig.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
          {error}
        </div>
      ) : null}

      <button type="submit" className="btn-primary w-full !py-3">
        {submitLabel}
      </button>
    </form>
  );
}
