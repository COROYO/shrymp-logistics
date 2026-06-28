import type { OrderInternalStatus } from "@/server/firestore/schema";

export type OrdersListFilter = "ALL" | OrderInternalStatus;

export const ORDERS_LIST_FILTERS: OrdersListFilter[] = [
  "ALL",
  "NEW",
  "SHIP",
  "PICKING",
  "STOP",
  "PACKED",
  "CANCELLED",
];
