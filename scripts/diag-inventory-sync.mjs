// Quick diagnosis: check whether
//   1. variant.on_hand_total equals sum(batches.remaining_qty)
//   2. recent shopify_outbox INVENTORY_SET entries are being drained
//   3. last bulk_push run actually had non-zero quantities
//
// Run: node --env-file=.env.local scripts/diag-inventory-sync.mjs
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

const variants = await db.collection("variants").get();
const batches = await db.collection("batches").get();

const sumByVariant = new Map();
for (const b of batches.docs) {
  const d = b.data();
  if (d.status === "EXPIRED") continue;
  sumByVariant.set(
    d.variant_id,
    (sumByVariant.get(d.variant_id) ?? 0) + (d.remaining_qty ?? 0),
  );
}

console.log("\n=== Variants where on_hand_total != sum(batches.remaining_qty) ===");
let drifts = 0;
let nonZeroVariants = 0;
for (const v of variants.docs) {
  const d = v.data();
  const onHand = d.on_hand_total ?? 0;
  const sumB = sumByVariant.get(v.id) ?? 0;
  if (onHand > 0 || sumB > 0) nonZeroVariants++;
  if (onHand !== sumB) {
    drifts++;
    console.log(
      `  ${v.id}  sku=${d.sku ?? "—"}  on_hand=${onHand}  sumBatches=${sumB}  reserved=${d.reserved_total ?? 0}  available=${d.available ?? 0}`,
    );
  }
}
console.log(`\nDrift variants: ${drifts} / non-zero variants: ${nonZeroVariants}`);

console.log("\n=== Outbox state (last 20 INVENTORY_SET entries) ===");
const allOutbox = await db
  .collection("shopify_outbox")
  .orderBy("created_at", "desc")
  .limit(50)
  .get();
const outbox = { docs: allOutbox.docs.filter((d) => d.data().op === "INVENTORY_SET").slice(0, 20) };
for (const o of outbox.docs) {
  const d = o.data();
  const setQ = d.payload?.setQuantities ?? [];
  const qSummary = setQ
    .slice(0, 3)
    .map((x) => `${x.inventoryItemId.slice(-12)}=${x.quantity}`)
    .join(",");
  console.log(
    `  ${d.created_at?.toDate?.()?.toISOString?.() ?? "?"}  done=${!!d.done_at}  attempts=${d.attempts}  count=${setQ.length}  err=${d.last_error?.slice(0, 80) ?? "-"}  q[${qSummary}]`,
  );
}

console.log("\n=== Config / shopify_meta ===");
const meta = await db.collection("config").doc("shopify_meta").get();
console.log("location_gid:", meta.data()?.location_gid);
console.log("shop_domain:", meta.data()?.shop_domain);
