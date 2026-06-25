import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  formatMoneyCents,
  getCustomerDetail,
} from "@/server/customers/aggregate";
import { OrderNoteIcon } from "@/app/_components/order-note-icon";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  NEW: "chip chip-soft",
  SHIP: "chip chip-emerald",
  PICKING: "chip chip-violet",
  STOP: "chip chip-amber",
  PACKED: "chip chip-sky",
  CANCELLED: "chip chip-soft",
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const detail = await getCustomerDetail(decodeURIComponent(key));
  if (!detail) notFound();

  const t = await getTranslations("customers.detail");

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/customers"
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-navy/60 transition hover:text-brand-burgundy"
        >
          {t("back")}
        </Link>
        <h1 className="h-display mt-3 text-3xl">{detail.displayName}</h1>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-brand-navy/70">
          {detail.email ? (
            <span className="font-mono">{detail.email}</span>
          ) : null}
          {detail.shopifyId ? (
            <span className="font-mono text-xs">
              {t("shopifyId", { id: detail.shopifyId })}
            </span>
          ) : null}
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label={t("stats.orders")} value={String(detail.orderCount)} />
        <Stat
          label={t("stats.totalRevenue")}
          value={formatMoneyCents(detail.totalSpendCents, detail.currency)}
        />
        <Stat
          label={t("stats.avgOrder")}
          value={
            detail.orderCount > 0
              ? formatMoneyCents(
                  Math.round(detail.totalSpendCents / detail.orderCount),
                  detail.currency,
                )
              : "—"
          }
        />
      </section>

      {detail.lastAddress ? (
        <section className="card p-5">
          <p className="eyebrow">{t("lastAddress")}</p>
          <address className="mt-2 not-italic text-sm leading-relaxed text-brand-ink">
            <strong>
              {detail.lastAddress.first_name} {detail.lastAddress.last_name}
            </strong>
            {detail.lastAddress.company ? (
              <>
                <br />
                {detail.lastAddress.company}
              </>
            ) : null}
            <br />
            {detail.lastAddress.address1}
            {detail.lastAddress.address2 ? (
              <>
                <br />
                {detail.lastAddress.address2}
              </>
            ) : null}
            <br />
            {detail.lastAddress.zip} {detail.lastAddress.city}
            <br />
            {detail.lastAddress.country}
          </address>
        </section>
      ) : null}

      <section className="card overflow-hidden">
        <div className="border-b border-zinc-200 px-6 py-4">
          <p className="eyebrow">{t("history")}</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {t("historySub")}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-brand">
            <thead>
              <tr>
                <th>{t("table.order")}</th>
                <th>{t("table.date")}</th>
                <th>{t("table.status")}</th>
                <th>{t("table.city")}</th>
                <th className="text-right">{t("table.items")}</th>
                <th className="text-right">{t("table.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.orders.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono font-bold text-brand-navy">
                    <span className="inline-flex items-center gap-1.5">
                      <OrderNoteIcon note={o.customer_note} />
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="hover:text-brand-burgundy"
                      >
                        {o.name}
                      </Link>
                    </span>
                  </td>
                  <td className="text-sm text-brand-navy/60">
                    {o.createdIso
                      ? new Date(o.createdIso).toLocaleString("de-DE", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "—"}
                  </td>
                  <td>
                    <span
                      className={
                        STATUS_BADGE[o.internal_status] ?? "chip chip-soft"
                      }
                    >
                      {o.internal_status}
                    </span>
                  </td>
                  <td className="text-sm text-brand-navy/70">
                    {o.city ?? "—"}
                  </td>
                  <td className="text-right font-semibold text-brand-navy">
                    {o.itemCount}
                  </td>
                  <td className="text-right font-mono text-sm">
                    {formatMoneyCents(o.totalCents, o.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-bold text-brand-navy">
        {value}
      </div>
    </div>
  );
}
