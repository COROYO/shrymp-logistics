"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import type { AccessibleShopOption } from "@/lib/auth/tenant";
import { selectShopAction } from "@/app/select-shop/actions";

export function ShopSwitcher({
  shops,
  currentShopId,
  showSuperBadge,
  nextPath,
}: {
  shops: AccessibleShopOption[];
  currentShopId: string;
  showSuperBadge?: boolean;
  nextPath?: string;
}) {
  const t = useTranslations("tenant");
  const [pending, startTransition] = useTransition();

  if (shops.length <= 1) return null;

  return (
    <div className="border-b border-white/10 px-4 pb-4">
      <label
        htmlFor="shop-switcher"
        className="mb-1.5 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40"
      >
        <span>{t("activeShop")}</span>
        {showSuperBadge ? (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] tracking-[0.12em] text-amber-200">
            {t("superAdmin")}
          </span>
        ) : null}
      </label>
      <select
        id="shop-switcher"
        disabled={pending}
        value={currentShopId}
        onChange={(e) => {
          const fd = new FormData();
          fd.set("shopId", e.target.value);
          if (nextPath) fd.set("next", nextPath);
          startTransition(() => selectShopAction(fd));
        }}
        className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-white outline-none transition focus:border-white/30 disabled:opacity-60"
      >
        {shops.map((shop) => (
          <option key={shop.id} value={shop.id} className="text-brand-navy">
            {shop.shop_domain}
          </option>
        ))}
      </select>
    </div>
  );
}
