import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import {
  loadDashboardStats,
  type DashboardDayPoint,
  type DashboardStats,
} from "@/server/admin/dashboard-stats";

const TILE_KEYS = [
  { href: "/admin/orders", key: "orders" },
  { href: "/admin/products", key: "products" },
  { href: "/admin/customers", key: "customers" },
  { href: "/admin/users", key: "users" },
  { href: "/admin/settings", key: "settings" },
  { href: "/lager", key: "lager" },
] as const;

function formatMoney(cents: number, currency: string, decimals = 0): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(cents / 100);
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("de-DE").format(n);
}

function formatDuration(min: number | null, naLabel: string): string {
  if (min == null) return naLabel;
  if (min < 60) return `${formatInt(Math.round(min))} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function Kpi({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  const accent =
    tone === "danger"
      ? "text-red-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "good"
          ? "text-emerald-600"
          : "text-brand-navy";
  return (
    <div className="card p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${accent}`}>
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-brand-navy/60">{sub}</p> : null}
    </div>
  );
}

function BarChart({
  data,
  pick,
  color,
  emptyLabel,
  formatValue,
}: {
  data: DashboardDayPoint[];
  pick: (d: DashboardDayPoint) => number;
  color: string;
  emptyLabel: string;
  formatValue: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map(pick));
  const hasData = data.some((d) => pick(d) > 0);
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {data.map((d) => {
          const v = pick(d);
          const heightPct = Math.round((v / max) * 100);
          const day = d.dateIso.slice(8, 10);
          return (
            <div
              key={d.dateIso}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${d.dateIso}: ${formatValue(v)}`}
            >
              <div
                className="w-full rounded-t-sm transition-all"
                style={{
                  height: `${Math.max(v > 0 ? 6 : 1, heightPct)}%`,
                  backgroundColor: v > 0 ? color : "var(--color-zinc-200, #e4e4e7)",
                }}
              />
              <span className="mt-1 text-[9px] text-brand-navy/40">{day}</span>
            </div>
          );
        })}
      </div>
      {!hasData ? (
        <p className="mt-2 text-center text-[11px] text-brand-navy/40">
          {emptyLabel}
        </p>
      ) : null}
    </div>
  );
}

function StatusRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-brand-navy">{label}</span>
        <span className="tabular-nums text-brand-navy/70">
          {formatInt(count)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

async function Dashboard({ stats }: { stats: DashboardStats }) {
  const t = await getTranslations("dashboard");
  const c = stats.currency;
  const open = stats.openOrders;
  const rev = stats.revenue;
  const tp = stats.throughput;
  const inv = stats.inventory;
  const b = stats.batches;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <Kpi
          label={t("kpi.openOrders")}
          value={formatInt(open.total)}
          sub={t("kpi.openOrdersSub", { stop: formatInt(open.stop) })}
          tone={open.stop > 0 ? "warn" : "default"}
        />
        <Kpi
          label={t("kpi.revenue30d")}
          value={formatMoney(rev.last30dCents, c)}
          sub={t("kpi.aov", { value: formatMoney(rev.aovCents, c, 2) })}
        />
        <Kpi
          label={t("kpi.revenueToday")}
          value={formatMoney(rev.todayCents, c)}
          sub={t("kpi.ordersToday", { count: formatInt(rev.ordersToday) })}
        />
        <Kpi
          label={t("kpi.packed")}
          value={formatInt(tp.packedToday)}
          sub={t("kpi.packed30d", { count: formatInt(tp.packed30d) })}
          tone="good"
        />
        <Kpi
          label={t("kpi.cycleTime")}
          value={formatDuration(tp.avgPickToPackMin, t("naShort"))}
          sub={t("kpi.cycleP90", {
            value: formatDuration(tp.p90PickToPackMin, t("naShort")),
          })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-brand-navy">
            {t("status.title")}
          </h2>
          <p className="mt-0.5 text-xs text-brand-navy/50">
            {t("status.subtitle")}
          </p>
          <div className="mt-4 space-y-3">
            <StatusRow
              label={t("status.new")}
              count={open.new}
              total={open.total}
              color="#64748b"
            />
            <StatusRow
              label={t("status.ship")}
              count={open.ship}
              total={open.total}
              color="#2563eb"
            />
            <StatusRow
              label={t("status.picking")}
              count={open.picking}
              total={open.total}
              color="#7c3aed"
            />
            <StatusRow
              label={t("status.stop")}
              count={open.stop}
              total={open.total}
              color="#dc2626"
            />
          </div>
          <Link
            href="/admin/orders"
            className="mt-4 inline-flex text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy"
          >
            {t("status.link")}
          </Link>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-brand-navy">
            {t("packedChart.title")}
          </h2>
          <p className="mt-0.5 text-xs text-brand-navy/50">
            {t("packedChart.subtitle", { days: stats.series.length })}
          </p>
          <div className="mt-4">
            <BarChart
              data={stats.series}
              pick={(d) => d.packed}
              color="#059669"
              emptyLabel={t("noData")}
              formatValue={(n) => `${formatInt(n)}`}
            />
          </div>
          <p className="mt-3 text-xs text-brand-navy/60">
            {t("packedChart.footer", {
              week: formatInt(tp.packed7d),
              samples: formatInt(tp.samples),
            })}
          </p>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-brand-navy">
            {t("revenueChart.title")}
          </h2>
          <p className="mt-0.5 text-xs text-brand-navy/50">
            {t("revenueChart.subtitle", { days: stats.series.length })}
          </p>
          <div className="mt-4">
            <BarChart
              data={stats.series}
              pick={(d) => d.revenueCents}
              color="#9d174d"
              emptyLabel={t("noData")}
              formatValue={(n) => formatMoney(n, c)}
            />
          </div>
          <p className="mt-3 text-xs text-brand-navy/60">
            {t("revenueChart.footer", {
              value: formatMoney(rev.last7dCents, c),
              orders: formatInt(rev.orders7d),
            })}
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-brand-navy">
            {t("inventory.title")}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label={t("inventory.value")} value={formatMoney(inv.valueCents, c)} />
            <Metric label={t("inventory.skus")} value={formatInt(inv.skuCount)} />
            <Metric label={t("inventory.onHand")} value={formatInt(inv.onHandUnits)} />
            <Metric label={t("inventory.reserved")} value={formatInt(inv.reservedUnits)} />
            <Metric
              label={t("inventory.outOfStock")}
              value={formatInt(inv.outOfStock)}
              tone={inv.outOfStock > 0 ? "danger" : "default"}
            />
            <Metric
              label={t("inventory.lowStock")}
              value={formatInt(inv.lowStock)}
              tone={inv.lowStock > 0 ? "warn" : "default"}
            />
          </div>
          <Link
            href="/admin/lagerbestand"
            className="mt-4 inline-flex text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy"
          >
            {t("inventory.link")}
          </Link>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-brand-navy">
            {t("batches.title")}
          </h2>
          {b.enabled ? (
            <>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Metric label={t("batches.active")} value={formatInt(b.active)} />
                <Metric
                  label={t("batches.expiring", { days: b.minDaysBeforeExpiry })}
                  value={formatInt(b.expiringSoon)}
                  tone={b.expiringSoon > 0 ? "warn" : "default"}
                />
                <Metric
                  label={t("batches.expired")}
                  value={formatInt(b.expired)}
                  tone={b.expired > 0 ? "danger" : "default"}
                />
              </div>
              <Link
                href="/admin/lagerbestand"
                className="mt-4 inline-flex text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy"
              >
                {t("batches.link")}
              </Link>
            </>
          ) : (
            <p className="mt-4 text-xs text-brand-navy/50">
              {t("batches.disabled")}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "danger";
}) {
  const accent =
    tone === "danger"
      ? "text-red-600"
      : tone === "warn"
        ? "text-amber-600"
        : "text-brand-navy";
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-navy/45">
        {label}
      </p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${accent}`}>
        {value}
      </p>
    </div>
  );
}

export default async function AdminHome() {
  const t = await getTranslations("adminHome");
  const td = await getTranslations("dashboard");

  const user = await getSessionUser();
  let stats: DashboardStats | null = null;
  if (user) {
    try {
      const shopId = await requireActiveShopId(user);
      stats = await loadDashboardStats(shopId);
    } catch {
      stats = null;
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      {stats ? (
        <Dashboard stats={stats} />
      ) : (
        <div className="card p-6 text-sm text-brand-navy/60">
          {td("unavailable")}
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
          {td("quickLinks")}
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TILE_KEYS.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="group card relative overflow-hidden p-6 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="absolute inset-x-0 top-0 h-1 bg-brand-burgundy opacity-0 transition group-hover:opacity-100" />
              <h2 className="text-base font-semibold text-brand-navy">
                {t(`tiles.${tile.key}.title`)}
              </h2>
              <p className="mt-2 text-xs text-brand-navy/60">
                {t(`tiles.${tile.key}.desc`)}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
                {t("open")}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
