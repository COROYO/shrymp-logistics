import Link from "next/link";
import { getTranslations } from "next-intl/server";

const TILE_KEYS = [
  { href: "/admin/orders", key: "orders" },
  { href: "/admin/batches", key: "batches" },
  { href: "/admin/products", key: "products" },
  { href: "/admin/customers", key: "customers" },
  { href: "/admin/users", key: "users" },
  { href: "/admin/settings", key: "settings" },
  { href: "/lager", key: "lager" },
] as const;

export default async function AdminHome() {
  const t = await getTranslations("adminHome");
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
  );
}
