"use client";

import { useTranslations } from "next-intl";
import {
  fulfillmentChipClass,
  lagerStatusChipClass,
  normalizeFulfillmentStatus,
  normalizePaymentStatus,
  paymentChipClass,
} from "@/lib/orders/shopify-status";

export function ShopifyStatusChip({
  kind,
  status,
}: {
  kind: "payment" | "fulfillment";
  status: string | null | undefined;
}) {
  const t = useTranslations("orderStatus");
  const code =
    kind === "payment"
      ? normalizePaymentStatus(status)
      : normalizeFulfillmentStatus(status);
  const key = code ? `${kind}Values.${code}` : "";
  const label = code ? (t.has(key) ? t(key) : code) : "—";
  const tone =
    kind === "payment" ? paymentChipClass(code) : fulfillmentChipClass(code);
  return <span className={tone}>{label}</span>;
}

export function LagerStatusChip({ status }: { status: string }) {
  return <span className={lagerStatusChipClass(status)}>{status}</span>;
}

export function OrderStatusRow({
  payment,
  fulfillment,
  lager,
}: {
  payment: string | null | undefined;
  fulfillment: string | null | undefined;
  lager: string;
}) {
  const t = useTranslations("orderStatus");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Labeled label={t("payment")}>
        <ShopifyStatusChip kind="payment" status={payment} />
      </Labeled>
      <Labeled label={t("fulfillment")}>
        <ShopifyStatusChip kind="fulfillment" status={fulfillment} />
      </Labeled>
      <Labeled label={t("lager")}>
        <LagerStatusChip status={lager} />
      </Labeled>
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/45">
        {label}
      </span>
      {children}
    </span>
  );
}
