import type { OrderInternalStatus } from "@/server/firestore/schema";

export type OrdersListFilter = "ALL" | "UNPAID" | OrderInternalStatus;

export const ORDERS_LIST_FILTERS: OrdersListFilter[] = [
  "ALL",
  "UNPAID",
  "NEW",
  "SHIP",
  "PICKING",
  "STOP",
  "PACKED",
  "CANCELLED",
];
