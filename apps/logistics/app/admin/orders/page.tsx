import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { TableSkeleton } from "@/app/_components/table-skeleton";
import { SyncOrdersButton } from "./sync-orders-button";
import {
  ORDERS_LIST_FILTERS,
  type OrdersListFilter,
} from "./filters";
import { OrdersContent } from "./orders-content";
import { OrdersSearch } from "./orders-search";
import { normalizeOrderSearchQuery } from "@/server/admin/order-search";

type Filter = OrdersListFilter;
const FILTERS = ORDERS_LIST_FILTERS;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const filter: Filter = (FILTERS as string[]).includes(status ?? "")
    ? (status as Filter)
    : "ALL";
  const query = normalizeOrderSearchQuery(q);

  const hrefFor = (f: Filter): string => {
    const params = new URLSearchParams();
    if (f !== "ALL") params.set("status", f);
    if (query) params.set("q", query);
    const s = params.toString();
    return s ? `/admin/orders?${s}` : "/admin/orders";
  };

  const t = await getTranslations("ordersAdmin");

  const filterLabel = (f: Filter): string => {
    if (f === "ALL") return t("filters.all");
    if (f === "UNPAID") return t("filters.unpaid");
    if (f === "NEW") return t("filters.new");
    if (f === "SHIP") return t("filters.ship");
    if (f === "STOP") return t("filters.stop");
    if (f === "PICKING") return t("filters.picking");
    if (f === "PACKED") return t("filters.packed");
    if (f === "CANCELLED") return t("filters.cancelled");
    return f;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
            {t("intro")}
          </p>
        </div>
        <SyncOrdersButton />
      </div>

      <div className="space-y-3">
        <OrdersSearch initialQuery={query} placeholder={t("search")} />

        <nav className="flex flex-wrap items-center gap-2 text-sm">
          {FILTERS.map((f) => {
            const isActive = filter === f;
            return (
              <Link
                key={f}
                href={hrefFor(f)}
                className={`rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition ${
                  isActive
                    ? "bg-brand-navy text-white"
                    : "border border-zinc-200 bg-white text-brand-navy/70 hover:border-brand-navy hover:text-brand-navy"
                }`}
              >
                {filterLabel(f)}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="card overflow-hidden">
        <Suspense
          key={`${filter}:${query}`}
          fallback={
            <div className="relative">
              <TableSkeleton rows={10} cols={4} />
            </div>
          }
        >
          <OrdersContent filter={filter} query={query} />
        </Suspense>
      </div>
    </div>
  );
}
