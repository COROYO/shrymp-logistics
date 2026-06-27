import { getTranslations } from "next-intl/server";
import { adminDb } from "@/server/firestore/admin";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { getShop } from "@/server/tenant/shop";
import { productsForShop, variantsForShop } from "@/server/tenant/queries";
import { ProductSyncButton } from "./sync-button";

export const dynamic = "force-dynamic";

async function getStats(shopId: string) {
  const db = adminDb();
  const [prodCount, varCount, shop] = await Promise.all([
    productsForShop(db, shopId)
      .count()
      .get()
      .then((s) => s.data().count)
      .catch(() => 0),
    variantsForShop(db, shopId)
      .count()
      .get()
      .then((s) => s.data().count)
      .catch(() => 0),
    getShop(shopId),
  ]);

  const updatedAt = shop?.updated_at;
  let updatedAtIso: string | null = null;
  const ts = updatedAt as unknown as { toDate?: () => Date };
  if (ts && typeof ts.toDate === "function") {
    updatedAtIso = ts.toDate().toISOString();
  }

  return {
    productCount: prodCount,
    variantCount: varCount,
    locationGid: shop?.location_gid ?? null,
    shopDomain: shop?.shop_domain ?? null,
    updatedAtIso,
  };
}

export default async function ProductsPage() {
  const { shopId } = await requireTenantPageContext("/admin/products");
  const stats = await getStats(shopId);
  const t = await getTranslations("products");
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("stats.products")} value={stats.productCount} />
        <Stat label={t("stats.variants")} value={stats.variantCount} />
        <Stat label={t("stats.shopDomain")} value={stats.shopDomain ?? "—"} mono />
        <Stat
          label={t("stats.lastSync")}
          value={
            stats.updatedAtIso
              ? new Date(stats.updatedAtIso).toLocaleString("de-DE")
              : t("stats.never")
          }
        />
      </dl>

      <section className="card p-6">
        <p className="eyebrow">{t("sync.eyebrow")}</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          {t("sync.title")}
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">{t("sync.intro")}</p>
        <div className="mt-4">
          <ProductSyncButton />
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="card p-5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </dt>
      <dd
        className={`mt-1.5 text-2xl font-bold tabular-nums text-brand-navy ${
          mono ? "font-mono text-base" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
