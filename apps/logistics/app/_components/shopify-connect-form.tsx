"use client";

import { useState, useTransition } from "react";
import { startShopifyConnectAction } from "@/app/shopify-connect-action";

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
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = shopDomain.trim();
    if (!trimmed) {
      setError("Bitte Shop-Domain eingeben.");
      return;
    }
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("Bitte Client ID und Client Secret der Shopify-App eintragen.");
      return;
    }
    startTransition(async () => {
      const res = await startShopifyConnectAction({
        shopDomain: trimmed,
        clientId,
        clientSecret,
      });
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={handleConnect} className={compact ? "space-y-3" : "space-y-5"}>
      <div>
        <label htmlFor="shopifyClientId" className={labelClass}>
          App Client ID
        </label>
        <input
          id="shopifyClientId"
          name="clientId"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Client ID aus dem Dev Dashboard"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="shopifyClientSecret" className={labelClass}>
          App Client Secret
        </label>
        <input
          id="shopifyClientSecret"
          name="clientSecret"
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Client Secret"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          className={inputClass}
        />
        {!compact ? (
          <p className="mt-1.5 text-xs text-brand-navy/55">
            Aus der Custom App im Shopify Dev Dashboard. Als Redirect-URL{" "}
            <span className="font-mono">/api/shopify/callback</span> auf dieser
            Domain hinterlegen.
          </p>
        ) : null}
      </div>

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
      </div>

      {error ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        className="btn-primary w-full !py-3"
        disabled={pending}
      >
        {pending ? "Weiter zu Shopify…" : submitLabel}
      </button>
    </form>
  );
}
