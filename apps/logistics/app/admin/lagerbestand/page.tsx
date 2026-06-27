import { getTranslations } from "next-intl/server";
import { adminDb } from "@/server/firestore/admin";
import {
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { productsForShop, variantsForShop } from "@/server/tenant/queries";
import { loadOrderDemandByVariant } from "@/server/inventory/reserved";
import { loadShippableQtyByVariant } from "@/server/inventory/shippable-stock";
import {
  LagerbestandTable,
  type LagerbestandRow,
} from "./lagerbestand-table";
import { ImportExportBar } from "./import-export";

export const dynamic = "force-dynamic";

async function loadRows(shopId: string): Promise<LagerbestandRow[]> {
  const db = adminDb();
  const [productsSnap, variantsSnap, reservedByVariant] = await Promise.all([
    productsForShop(db, shopId).get(),
    variantsForShop(db, shopId).get(),
    loadOrderDemandByVariant(shopId),
  ]);
  const variantIds = variantsSnap.docs.map((d) => d.id);
  const shippableByVariant = await loadShippableQtyByVariant(variantIds, shopId);

  const products = new Map<string, Product>();
  for (const p of productsSnap.docs) {
    products.set(p.id, p.data() as Product);
  }

  const rows: LagerbestandRow[] = [];
  for (const v of variantsSnap.docs) {
    const variant = v.data() as Variant;
    const product = products.get(variant.product_id);
    if (!product) continue;
    if (product.status === "ARCHIVED" || product.is_bundle === true) continue;

    const onHand = shippableByVariant.get(variant.id) ?? 0;
    const reserved = reservedByVariant.get(variant.id) ?? 0;

    rows.push({
      productId: product.id,
      variantId: variant.id,
      productTitle: product.title,
      variantTitle: variant.title,
      sku: variant.sku ?? null,
      onHand,
      reserved,
      difference: onHand - reserved,
    });
  }

  rows.sort((a, b) => {
    const byProduct = a.productTitle.localeCompare(b.productTitle);
    if (byProduct !== 0) return byProduct;
    return a.variantTitle.localeCompare(b.variantTitle);
  });

  return rows;
}

export default async function LagerbestandPage() {
  const { shopId } = await requireTenantPageContext("/admin/lagerbestand");
  const rows = await loadRows(shopId);
  const t = await getTranslations("lagerbestand");

  const totals = rows.reduce(
    (acc, r) => ({
      onHand: acc.onHand + r.onHand,
      reserved: acc.reserved + r.reserved,
      difference: acc.difference + r.difference,
    }),
    { onHand: 0, reserved: 0, difference: 0 },
  );

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-4 text-sm">
        <Stat label={t("stats.variants")} value={rows.length} />
        <Stat label={t("stats.onHand")} value={totals.onHand} />
        <Stat label={t("stats.reserved")} value={totals.reserved} />
        <Stat label={t("stats.difference")} value={totals.difference} />
      </dl>

      <ImportExportBar />

      {rows.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-brand-navy/60">
          {t.rich("emptyNoSync", {
            link: (chunks) => (
              <a
                href="/admin/products"
                className="font-semibold text-brand-burgundy underline-offset-2 hover:underline"
              >
                {chunks}
              </a>
            ),
          })}
        </div>
      ) : (
        <LagerbestandTable rows={rows} />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="card p-5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </dt>
      <dd className="mt-1.5 text-2xl font-bold tabular-nums text-brand-navy">
        {value}
      </dd>
    </div>
  );
}
