"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TableSkeleton } from "@/app/_components/table-skeleton";
import {
  OrdersTable,
  type OrderRow,
} from "./orders-table";
import type { OrdersListFilter } from "./filters";

export function OrdersDataLoader({ filter }: { filter: OrdersListFilter }) {
  const t = useTranslations("common");
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setOrders(null);

    const qs =
      filter === "ALL" ? "" : `?status=${encodeURIComponent(filter)}`;
    fetch(`/api/v1/orders${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error("fetch_failed");
        return r.json() as Promise<{ data: { orders: OrderRow[] } }>;
      })
      .then((payload) => {
        if (!cancelled) setOrders(payload.data.orders);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [filter]);

  if (error) {
    return (
      <div className="px-6 py-10 text-center text-sm text-red-700">
        Daten konnten nicht geladen werden.
      </div>
    );
  }

  if (!orders) {
    return (
      <div className="relative">
        <div className="absolute inset-x-0 top-3 z-10 text-center text-xs text-brand-navy/50">
          {t("loading")}
        </div>
        <TableSkeleton rows={10} cols={4} />
      </div>
    );
  }

  return <OrdersTable orders={orders} />;
}
