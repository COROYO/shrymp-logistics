import Link from "next/link";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { NewBatchForm, type VariantOption } from "./new-batch-form";

export const dynamic = "force-dynamic";

type BatchRow = {
  id: string;
  variant_id: string;
  variant_label: string;
  charge_number: string;
  expiry_date_iso: string | null;
  remaining_qty: number;
  initial_qty: number;
  status: string;
};

async function loadVariantOptions(): Promise<VariantOption[]> {
  const db = adminDb();
  const [variantsSnap, productsSnap] = await Promise.all([
    db.collection(Collections.Variants).get(),
    db.collection(Collections.Products).get(),
  ]);

  const productTitleById = new Map<string, string>();
  for (const p of productsSnap.docs) {
    productTitleById.set(p.id, (p.data().title as string | undefined) ?? p.id);
  }

  const options: VariantOption[] = variantsSnap.docs.map((v) => {
    const d = v.data();
    const productTitle =
      productTitleById.get(d.product_id as string) ?? d.product_id ?? "?";
    const variantTitle = (d.title as string | undefined) ?? "—";
    const sku = (d.sku as string | undefined) ?? null;
    const label = `${productTitle} · ${variantTitle}${sku ? ` (${sku})` : ""}`;
    return { id: v.id, label };
  });
  options.sort((a, b) => a.label.localeCompare(b.label));
  return options;
}

async function loadRecentBatches(): Promise<BatchRow[]> {
  const db = adminDb();
  // No composite-orderby on expiry_date here — keep simple, sort in-memory.
  const snap = await db
    .collection(Collections.Batches)
    .where("status", "==", "ACTIVE")
    .limit(50)
    .get();

  if (snap.empty) return [];

  const variantIds = Array.from(
    new Set(snap.docs.map((d) => d.data().variant_id as string)),
  );
  const variantLabels = await Promise.all(
    variantIds.map(async (vid) => {
      const v = await db.collection(Collections.Variants).doc(vid).get();
      if (!v.exists) return [vid, vid] as const;
      const d = v.data() ?? {};
      const productId = d.product_id as string | undefined;
      let productTitle = productId ?? "?";
      if (productId) {
        const p = await db
          .collection(Collections.Products)
          .doc(productId)
          .get();
        if (p.exists)
          productTitle =
            (p.data()?.title as string | undefined) ?? productId;
      }
      const label = `${productTitle} · ${(d.title as string | undefined) ?? "—"}`;
      return [vid, label] as const;
    }),
  );
  const labelByVariant = new Map(variantLabels);

  const rows: BatchRow[] = snap.docs.map((d) => {
    const data = d.data();
    const expiry = data.expiry_date as
      | { toDate(): Date }
      | { seconds: number }
      | undefined;
    let iso: string | null = null;
    if (expiry && "toDate" in expiry) {
      iso = expiry.toDate().toISOString().slice(0, 10);
    } else if (expiry && "seconds" in expiry) {
      iso = new Date(expiry.seconds * 1000).toISOString().slice(0, 10);
    }
    return {
      id: d.id,
      variant_id: data.variant_id as string,
      variant_label:
        labelByVariant.get(data.variant_id as string) ?? data.variant_id,
      charge_number: data.charge_number as string,
      expiry_date_iso: iso,
      remaining_qty: (data.remaining_qty as number | undefined) ?? 0,
      initial_qty: (data.initial_qty as number | undefined) ?? 0,
      status: (data.status as string | undefined) ?? "ACTIVE",
    };
  });

  rows.sort((a, b) => {
    if (a.expiry_date_iso === b.expiry_date_iso) {
      return a.variant_label.localeCompare(b.variant_label);
    }
    if (!a.expiry_date_iso) return 1;
    if (!b.expiry_date_iso) return -1;
    return a.expiry_date_iso.localeCompare(b.expiry_date_iso);
  });

  return rows;
}

export default async function BatchesPage() {
  const [variants, batches] = await Promise.all([
    loadVariantOptions(),
    loadRecentBatches(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Wareneingang</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Neue Charge mit MHD anlegen. Triggert automatisch eine
          Re-Allokation aller offenen Bestellungen.
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Neue Charge erfassen</h2>
        {variants.length === 0 ? (
          <p className="mt-2 text-sm text-amber-700">
            Es sind noch keine Varianten synchronisiert.{" "}
            <Link
              href="/admin/products"
              className="underline hover:no-underline"
            >
              Zuerst Produkte synchronisieren
            </Link>
            .
          </p>
        ) : (
          <div className="mt-4">
            <NewBatchForm variants={variants} />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-6 py-3">
          <h2 className="text-sm font-semibold">
            Aktive Chargen ({batches.length})
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            FEFO-Reihenfolge (älteste MHD zuerst)
          </p>
        </div>
        {batches.length === 0 ? (
          <p className="px-6 py-6 text-sm text-zinc-500">
            Noch keine aktiven Chargen.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50">
                <tr className="text-left">
                  <th className="px-6 py-2 font-medium">MHD</th>
                  <th className="px-6 py-2 font-medium">Variante</th>
                  <th className="px-6 py-2 font-medium">Charge</th>
                  <th className="px-6 py-2 font-medium text-right">
                    Restmenge
                  </th>
                  <th className="px-6 py-2 font-medium text-right">
                    Wareneingang
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="px-6 py-2 font-mono">
                      {b.expiry_date_iso ?? "—"}
                    </td>
                    <td className="px-6 py-2">{b.variant_label}</td>
                    <td className="px-6 py-2 font-mono">{b.charge_number}</td>
                    <td className="px-6 py-2 text-right font-semibold">
                      {b.remaining_qty}
                    </td>
                    <td className="px-6 py-2 text-right text-zinc-500">
                      {b.initial_qty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
