// READ-ONLY. Scan ALL orders for the double-deduction bug (same order consumed
// its Chargen more than once) and report the affected Chargen + products.
//
// Signal: an order whose consumed (consumed_at set, NOT released) allocations
// fall into 2+ distinct consume-time clusters. The earliest cluster is the
// legitimate deduction; every later cluster is a duplicate (the bug). We also
// compare total consumed vs. ordered quantity per variant to classify
// confidence:
//   CONFIRMED  consumed > ordered            → real over-deduction
//   REVIEW     2+ clusters but consumed≤order → unusual, eyeball it
//   NO-ORDER   order doc missing             → can't compare demand
//
// "Wrong units" per Charge = units consumed in the duplicate (later) clusters —
// i.e. how much to add back to that batch when correcting.
//
// Run: node --env-file=.env.local scripts/scan-double-deductions.mjs [--since=YYYY-MM-DD]
import admin from "firebase-admin";
import { writeFileSync } from "node:fs";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    ),
  });
}
const db = admin.firestore();

const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const since = sinceArg ? new Date(sinceArg.split("=")[1]) : null;
const iso = (ts) => ts?.toDate?.()?.toISOString?.() ?? "—";
const hm = (ts) => ts?.toDate?.()?.toISOString?.()?.slice(11, 16) ?? "—";
const clusterKey = (ts) => Math.round((ts?.toMillis?.() ?? 0) / 1000); // second precision

async function chunkedGetAll(coll, ids) {
  const out = new Map();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 300) {
    const refs = uniq.slice(i, i + 300).map((id) => db.collection(coll).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) if (s.exists) out.set(s.id, s.data());
  }
  return out;
}

// ---- 1. Page through all CONSUMED, non-released allocations ----
const PAGE = 3000;
const byOrder = new Map(); // order_id -> allocations[]
let last = null;
let scanned = 0;
for (;;) {
  let q = db.collection("allocations").orderBy("consumed_at").limit(PAGE);
  if (since) q = q.where("consumed_at", ">=", admin.firestore.Timestamp.fromDate(since));
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (snap.empty) break;
  for (const d of snap.docs) {
    const a = d.data();
    scanned++;
    if (a.released) continue;
    if (!a.consumed_at) continue;
    if (!byOrder.has(a.order_id)) byOrder.set(a.order_id, []);
    byOrder.get(a.order_id).push(a);
  }
  last = snap.docs[snap.docs.length - 1];
  if (snap.size < PAGE) break;
}
console.log(`Gescannt: ${scanned} konsumierte Allocations über ${byOrder.size} Orders.\n`);

// ---- 2. Keep only orders with 2+ consume-time clusters ----
const candidates = [];
for (const [orderId, allocs] of byOrder) {
  const clusters = new Map(); // clusterKey -> allocations[]
  for (const a of allocs) {
    const k = clusterKey(a.consumed_at);
    if (!clusters.has(k)) clusters.set(k, []);
    clusters.get(k).push(a);
  }
  if (clusters.size >= 2) candidates.push({ orderId, allocs, clusters });
}

// ---- 3. Load orders (demand) + enrich ----
const orders = await chunkedGetAll("orders", candidates.map((c) => c.orderId));

// variant_id -> human product name, taken from order line-item titles (the
// variant doc's `title` is only the size option like "300g").
const productNameByVariant = new Map();
for (const o of orders.values()) {
  for (const li of o.line_items ?? []) {
    if (li.variant_id && li.title && !productNameByVariant.has(li.variant_id)) {
      productNameByVariant.set(li.variant_id, li.title);
    }
  }
}

const affected = []; // { orderId, name, status, confidence, clusters, demandByVariant, consumedByVariant, wrongByBatch }
for (const c of candidates) {
  const order = orders.get(c.orderId);
  const demandByVariant = {};
  for (const li of order?.line_items ?? []) {
    demandByVariant[li.variant_id] = (demandByVariant[li.variant_id] ?? 0) + li.qty;
  }
  const consumedByVariant = {};
  for (const a of c.allocs) {
    consumedByVariant[a.variant_id] = (consumedByVariant[a.variant_id] ?? 0) + a.qty;
  }
  // duplicate clusters = all but the earliest
  const sortedKeys = [...c.clusters.keys()].sort((a, b) => a - b);
  const dupKeys = sortedKeys.slice(1);
  const wrongByBatch = {}; // batch_id -> qty
  let wrongUnits = 0;
  for (const k of dupKeys) {
    for (const a of c.clusters.get(k)) {
      wrongByBatch[a.batch_id] = (wrongByBatch[a.batch_id] ?? 0) + a.qty;
      wrongUnits += a.qty;
    }
  }
  let over = 0;
  for (const v of new Set([...Object.keys(demandByVariant), ...Object.keys(consumedByVariant)])) {
    over += Math.max(0, (consumedByVariant[v] ?? 0) - (demandByVariant[v] ?? 0));
  }
  const confidence = !order ? "NO-ORDER" : over > 0 ? "CONFIRMED" : "REVIEW";
  affected.push({
    orderId: c.orderId,
    name: order?.name ?? `(id ${c.orderId})`,
    status: order?.internal_status ?? "?",
    confidence,
    clusterTimes: sortedKeys.map((k) => hm(c.clusters.get(k)[0].consumed_at)),
    over,
    wrongUnits,
    wrongByBatch,
    firstConsumed: c.allocs.reduce((m, a) => (clusterKey(a.consumed_at) === sortedKeys[0] ? a.consumed_at : m), null),
  });
}

// ---- 4. Aggregate per Charge (batch) + load batch/variant details ----
const allBatchIds = affected.flatMap((a) => Object.keys(a.wrongByBatch));
const batches = await chunkedGetAll("batches", allBatchIds);
const variants = await chunkedGetAll("variants", [...batches.values()].map((b) => b.variant_id));

const perCharge = new Map(); // batch_id -> { charge_number, variant_id, title, sku, remaining, status, wrong, orders:[{name,qty}] }
for (const a of affected) {
  if (a.confidence === "REVIEW") continue; // count only real over-deductions in the Charge totals
  for (const [batchId, qty] of Object.entries(a.wrongByBatch)) {
    const b = batches.get(batchId);
    const v = b ? variants.get(b.variant_id) : null;
    if (!perCharge.has(batchId)) {
      perCharge.set(batchId, {
        charge_number: b?.charge_number ?? "(Charge gelöscht)",
        variant_id: b?.variant_id ?? "?",
        product: productNameByVariant.get(b?.variant_id) ?? v?.title ?? "(Produkt unbekannt)",
        variantTitle: v?.title ?? "",
        sku: v?.sku ?? "—",
        remaining: b?.remaining_qty ?? "?",
        status: b?.status ?? "?",
        wrong: 0,
        orders: [],
      });
    }
    const e = perCharge.get(batchId);
    e.wrong += qty;
    e.orders.push({ name: a.name, qty });
  }
}

// ---- 5. Report ----
console.log("================ KORREKTUR-LISTE: doppelt abgebuchte Chargen ================");
console.log("(remaining_qty pro Charge um +Korrektur erhöhen — editBatch zieht on_hand_total automatisch mit)\n");
const charges = [...perCharge.entries()].sort((x, y) => {
  const p = x[1].product.localeCompare(y[1].product);
  return p !== 0 ? p : x[1].charge_number.localeCompare(y[1].charge_number);
});
const csv = [
  "produkt;variante;sku;charge;batch_id;variant_id;status;aktuell_remaining;korrektur_plus;neu_remaining;orders",
];
const csvField = (f) => {
  const s = String(f ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
if (charges.length === 0) {
  console.log("  Keine bestätigten Doppel-Abbuchungen gefunden. 🎉\n");
} else {
  for (const [batchId, e] of charges) {
    const prod = e.variantTitle ? `${e.product} – ${e.variantTitle}` : e.product;
    const neu = typeof e.remaining === "number" ? e.remaining + e.wrong : "?";
    const orders = e.orders.map((o) => `${o.name} (${o.qty})`).join(", ");
    console.log(`Charge ${e.charge_number}  ·  ${prod}  (SKU ${e.sku})`);
    console.log(`   aktuell remaining_qty = ${e.remaining}   →   +${e.wrong}   →   NEU = ${neu}`);
    console.log(`   batch=${batchId}  variant=${e.variant_id}  Status=${e.status}`);
    console.log(`   verursacht durch: ${orders}\n`);
    csv.push(
      [e.product, e.variantTitle, e.sku, e.charge_number, batchId, e.variant_id, e.status, e.remaining, e.wrong, neu, orders]
        .map(csvField)
        .join(";"),
    );
  }
  const csvPath = "scripts/double-deduction-correction.csv";
  writeFileSync(csvPath, csv.join("\n") + "\n");
  console.log(`📄 CSV zum Abhaken geschrieben: ${csvPath}\n`);
}

console.log("================ Betroffene Orders (Übersicht) ================\n");
for (const a of affected.sort((x, y) => (x.confidence < y.confidence ? -1 : 1))) {
  console.log(
    `${a.name.padEnd(8)} [${a.confidence}]  status=${a.status}  ` +
    `Consume-Cluster: ${a.clusterTimes.length} (${a.clusterTimes.join(", ")})  ` +
    `Überverbrauch=${a.over}  doppelt abgebucht=${a.wrongUnits} Einheiten`,
  );
}

// ---- 6. Summary ----
const confirmed = affected.filter((a) => a.confidence === "CONFIRMED");
const totalWrong = [...perCharge.values()].reduce((s, e) => s + e.wrong, 0);
console.log("\n================ Summary ================");
console.log(`  Orders mit Doppel-Abbuchung (CONFIRMED): ${confirmed.length}`);
console.log(`  Davon zur Prüfung (REVIEW):              ${affected.filter((a) => a.confidence === "REVIEW").length}`);
console.log(`  Ohne Order-Doc (NO-ORDER):               ${affected.filter((a) => a.confidence === "NO-ORDER").length}`);
console.log(`  Betroffene Chargen:                      ${perCharge.size}`);
console.log(`  Fälschlich abgebuchte Einheiten gesamt:  ${totalWrong}`);
console.log();
