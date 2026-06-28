import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SyncOrdersButton } from "./sync-orders-button";
import {
  ORDERS_LIST_FILTERS,
  type OrdersListFilter,
} from "./filters";
import { OrdersDataLoader } from "./orders-data-loader";

type Filter = OrdersListFilter;
const FILTERS = ORDERS_LIST_FILTERS;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter: Filter = (FILTERS as string[]).includes(status ?? "")
    ? (status as Filter)
    : "ALL";

  const t = await getTranslations("ordersAdmin");

  const filterLabel = (f: Filter): string => {
    if (f === "ALL") return t("filters.all");
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

      <nav className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map((f) => {
          const isActive = filter === f;
          return (
            <Link
              key={f}
              href={f === "ALL" ? "/admin/orders" : `/admin/orders?status=${f}`}
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

      <div className="card overflow-hidden">
        <OrdersDataLoader filter={filter} />
      </div>
    </div>
  );
}
