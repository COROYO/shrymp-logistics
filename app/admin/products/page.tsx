import { adminDb } from "@/server/firestore/admin";
import { Collections, ConfigDocs } from "@/server/firestore/schema";
import { ProductSyncButton } from "./sync-button";

export const dynamic = "force-dynamic";

async function getStats() {
  const db = adminDb();
  const [prodCount, varCount, configSnap] = await Promise.all([
    db
      .collection(Collections.Products)
      .count()
      .get()
      .then((s) => s.data().count)
      .catch(() => 0),
    db
      .collection(Collections.Variants)
      .count()
      .get()
      .then((s) => s.data().count)
      .catch(() => 0),
    db
      .collection(Collections.Config)
      .doc(ConfigDocs.ShopifyMeta)
      .get()
      .catch(() => null),
  ]);

  const config = configSnap?.exists ? configSnap.data() : null;
  const updatedAt = config?.["updated_at"];
  const updatedAtIso =
    updatedAt && typeof updatedAt === "object" && "toDate" in updatedAt
      ? (updatedAt as { toDate(): Date }).toDate().toISOString()
      : null;

  return {
    productCount: prodCount,
    variantCount: varCount,
    locationGid: (config?.["location_gid"] as string | undefined) ?? null,
    shopDomain: (config?.["shop_domain"] as string | undefined) ?? null,
    updatedAtIso,
  };
}

export default async function ProductsPage() {
  const stats = await getStats();
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Stammdaten</p>
        <h1 className="h-display mt-1 text-3xl">Produkte</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
          Shopify-Katalog spiegeln. Bestände werden separat über Wareneingang
          gepflegt, hier nur Stammdaten.
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Produkte" value={stats.productCount} />
        <Stat label="Varianten" value={stats.variantCount} />
        <Stat label="Shop-Domain" value={stats.shopDomain ?? "—"} mono />
        <Stat
          label="Letzter Sync"
          value={
            stats.updatedAtIso
              ? new Date(stats.updatedAtIso).toLocaleString("de-DE")
              : "nie"
          }
        />
      </dl>

      <section className="card p-6">
        <p className="eyebrow">Synchronisation</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">Voll-Sync</h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Lädt alle Produkte und Varianten aus Shopify nach Firestore. Bestehende
          Bestände (on_hand_total, reserved_total) werden nicht überschrieben.
        </p>
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
