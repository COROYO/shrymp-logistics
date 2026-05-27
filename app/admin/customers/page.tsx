import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatMoneyCents, listCustomers } from "@/server/customers/aggregate";
import { BackfillAllOrdersButton } from "./backfill-button";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await listCustomers();
  const t = await getTranslations("customers");

  const totalRevenue = customers.reduce((s, c) => s + c.totalSpendCents, 0);
  const currency = customers[0]?.currency ?? "EUR";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
            {t("intro")}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Stat label={t("stats.customers")} value={String(customers.length)} />
          <Stat
            label={t("stats.totalRevenue")}
            value={formatMoneyCents(totalRevenue, currency)}
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        {customers.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-brand-navy/60">
            {t.rich("empty", {
              action: t("backfill.button"),
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-brand">
              <thead>
                <tr>
                  <th>{t("table.customer")}</th>
                  <th>{t("table.email")}</th>
                  <th className="text-right">{t("table.orderCount")}</th>
                  <th className="text-right">{t("table.revenue")}</th>
                  <th>{t("table.firstOrder")}</th>
                  <th>{t("table.lastOrder")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.key}>
                    <td className="font-semibold text-brand-navy">
                      {c.displayName}
                    </td>
                    <td className="font-mono text-xs text-brand-navy/70">
                      {c.email ?? "—"}
                    </td>
                    <td className="text-right font-semibold text-brand-navy">
                      {c.orderCount}
                    </td>
                    <td className="text-right font-mono text-sm">
                      {formatMoneyCents(c.totalSpendCents, c.currency)}
                    </td>
                    <td className="text-sm text-brand-navy/60">
                      {fmtDate(c.firstOrderIso)}
                    </td>
                    <td className="text-sm text-brand-navy/60">
                      {fmtDate(c.lastOrderIso)}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/admin/customers/${encodeURIComponent(c.key)}`}
                        className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy hover:underline"
                      >
                        {t("table.history")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <section className="card p-6">
        <p className="eyebrow">{t("backfill.eyebrow")}</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          {t("backfill.title")}
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-brand-navy/60">
          {t.rich("backfill.intro", { b: (chunks) => <strong>{chunks}</strong> })}
        </p>
        <div className="mt-5">
          <BackfillAllOrdersButton />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3 text-right">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </div>
      <div className="font-mono text-lg font-bold text-brand-navy">{value}</div>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}
