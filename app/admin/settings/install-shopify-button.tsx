"use client";
import { useState } from "react";

export function InstallShopifyAppLink({
  shopDomain,
  installed,
}: {
  shopDomain: string | null;
  installed: boolean;
}) {
  const [shop, setShop] = useState(shopDomain ?? "");
  const href = shop
    ? `/api/shopify/install?shop=${encodeURIComponent(shop)}`
    : "#";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
          Shop-Domain
        </label>
        <input
          type="text"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          placeholder="monolithcaviar.myshopify.com"
          className="mt-1 w-72 rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
        />
      </div>
      <a
        href={href}
        aria-disabled={!shop}
        className={`rounded-md px-4 py-2 text-sm font-medium ${
          shop
            ? "bg-zinc-900 text-white hover:bg-zinc-800"
            : "bg-zinc-200 text-zinc-500 pointer-events-none"
        }`}
      >
        {installed
          ? "App neu installieren / Token erneuern"
          : "Shopify-App installieren"}
      </a>
    </div>
  );
}
