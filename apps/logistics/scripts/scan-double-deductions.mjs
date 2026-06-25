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
// For Chargen with a manual "Double #…" ADJUSTMENT: re-check whether any order
// consumed from that Charge again AFTER the fix (must not — one deduction per order).
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

// ---- 4b. Manual "Double #…" corrections (per batch) ----
// The merchant fixes a double-deduction by adding stock back per Charge with an
// ADJUSTMENT movement noted "Double #<orders>". Note formats are inconsistent
// (##, tabs, "(2)", missing #), but batch_id + qty are reliable, so we net out
// per batch.
const correctedByBatch = new Map();
const doubleFixesByBatch = new Map(); // batch_id -> { totalQty, latestFixAt, fixes[] }
let doubleMovements = 0;
{
  let last = null;
  for (;;) {
    let q = db.collection("inventory_movements").orderBy("created_at").limit(3000);
    if (last) q = q.startAfter(last);
    const s = await q.get();
    if (s.empty) break;
    for (const d of s.docs) {
      const m = d.data();
      if (m.batch_id && typeof m.note === "string" && /double/i.test(m.note)) {
        correctedByBatch.set(m.batch_id, (correctedByBatch.get(m.batch_id) ?? 0) + (m.qty ?? 0));
        if (!doubleFixesByBatch.has(m.batch_id)) {
          doubleFixesByBatch.set(m.batch_id, { totalQty: 0, latestFixAt: null, fixes: [] });
        }
        const fix = doubleFixesByBatch.get(m.batch_id);
        fix.totalQty += m.qty ?? 0;
        fix.fixes.push({ created_at: m.created_at, note: m.note, qty: m.qty ?? 0 });
        const ms = m.created_at?.toMillis?.() ?? 0;
        if (!fix.latestFixAt || ms > fix.latestFixAt.toMillis()) fix.latestFixAt = m.created_at;
        doubleMovements++;
      }
    }
    last = s.docs[s.docs.length - 1];
    if (s.size < 3000) break;
  }
}
for (const batchId of [...perCharge.keys()]) {
  if (correctedByBatch.has(batchId)) perCharge.delete(batchId);
}

// ---- 4c. After a Double# fix: same order must not deduct from that Charge again ----
// One order → one consume cluster per batch. If a Charge was corrected and an order
// still has 2+ clusters with any AFTER the fix, that's a regression.
const postFixIssues = [];
if (doubleFixesByBatch.size > 0) {
  const fixBatchIds = [...doubleFixesByBatch.keys()];
  const fixBatches = await chunkedGetAll("batches", fixBatchIds);
  const fixVariants = await chunkedGetAll(
    "variants",
    [...fixBatches.values()].map((b) => b.variant_id),
  );

  for (const batchId of fixBatchIds) {
    const fixInfo = doubleFixesByBatch.get(batchId);
    if (!fixInfo.latestFixAt) continue;
    const fixMs = fixInfo.latestFixAt.toMillis();

    const allocSnap = await db.collection("allocations").where("batch_id", "==", batchId).get();
    const consumed = allocSnap.docs
      .map((d) => d.data())
      .filter((a) => a.consumed_at && !a.released);

    const byOrder = new Map();
    for (const a of consumed) {
      if (!byOrder.has(a.order_id)) byOrder.set(a.order_id, []);
      byOrder.get(a.order_id).push(a);
    }

    const b = fixBatches.get(batchId);
    const v = b ? fixVariants.get(b.variant_id) : null;
    const product = productNameByVariant.get(b?.variant_id) ?? v?.title ?? "(Produkt unbekannt)";

    for (const [orderId, allocs] of byOrder) {
      const clusters = new Map();
      for (const a of allocs) {
        const k = clusterKey(a.consumed_at);
        if (!clusters.has(k)) clusters.set(k, []);
        clusters.get(k).push(a);
      }
      if (clusters.size < 2) continue;

      const sortedKeys = [...clusters.keys()].sort((a, b) => a - b);
      let preFixQty = 0;
      let postFixQty = 0;
      const clusterTimes = [];
      for (const k of sortedKeys) {
        const rows = clusters.get(k);
        const ts = rows[0].consumed_at;
        const qty = rows.reduce((s, a) => s + a.qty, 0);
        clusterTimes.push(hm(ts));
        if (ts.toMillis() > fixMs) postFixQty += qty;
        else preFixQty += qty;
      }
      if (postFixQty <= 0) continue;

      postFixIssues.push({
        batchId,
        orderId,
        charge_number: b?.charge_number ?? "(Charge gelöscht)",
        product,
        variantTitle: v?.title ?? "",
        sku: v?.sku ?? "—",
        remaining: b?.remaining_qty ?? "?",
        status: b?.status ?? "?",
        variant_id: b?.variant_id ?? "?",
        fixAt: iso(fixInfo.latestFixAt),
        preFixQty,
        postFixQty,
        clusterTimes,
        fixNotes: fixInfo.fixes.map((f) => f.note).join(" | "),
      });
    }
  }

  const postFixOrderIds = [...new Set(postFixIssues.map((i) => i.orderId))];
  const postFixOrders = await chunkedGetAll("orders", postFixOrderIds);
  for (const issue of postFixIssues) {
    issue.orderName = postFixOrders.get(issue.orderId)?.name ?? `(id ${issue.orderId})`;
  }
}

// ---- 5. Report ----
const csvField = (f) => {
  const s = String(f ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const sortCharges = (arr) =>
  arr.sort((x, y) => {
    const p = x[1].product.localeCompare(y[1].product);
    return p !== 0 ? p : x[1].charge_number.localeCompare(y[1].charge_number);
  });
const offen = sortCharges([...perCharge.entries()]);

console.log("================ NOCH ZU KORRIGIEREN ================");
console.log("(remaining_qty pro Charge um +KORR erhöhen — editBatch zieht on_hand_total mit)\n");
if (offen.length === 0) {
  console.log("  🎉 Keine unkorrigierten Chargen mehr.\n");
} else {
  for (const [batchId, e] of offen) {
    const prod = e.variantTitle ? `${e.product} – ${e.variantTitle}` : e.product;
    const neu = typeof e.remaining === "number" ? e.remaining + e.wrong : "?";
    const orders = e.orders.map((o) => `${o.name} (${o.qty})`).join(", ");
    console.log(`Charge ${e.charge_number}  ·  ${prod}  (SKU ${e.sku})`);
    console.log(`   doppelt abgebucht +${e.wrong}   →   aktuell ${e.remaining}  →  NEU = ${neu}`);
    console.log(`   batch=${batchId}  variant=${e.variant_id}  Status=${e.status}`);
    console.log(`   verursacht durch: ${orders}\n`);
  }
}

// CSV: offene Chargen + Post-Fix-Wiederholungen (eine Zeile pro Charge).
const csv = [
  "produkt;variante;sku;charge;batch_id;variant_id;status;aktuell_remaining;doppelt_abgebucht;bereits_korrigiert;hat_double_fix;zustand;noch_zu_addieren;neu_remaining;fix_at;orders",
];
for (const [batchId, e] of offen) {
  const neu = typeof e.remaining === "number" ? e.remaining + e.wrong : "?";
  const orders = e.orders.map((o) => `${o.name} (${o.qty})`).join(", ");
  csv.push(
    [e.product, e.variantTitle, e.sku, e.charge_number, batchId, e.variant_id, e.status, e.remaining, e.wrong, 0, "nein", "OFFEN", e.wrong, neu, "", orders]
      .map(csvField)
      .join(";"),
  );
}
const postFixByCharge = new Map();
for (const i of postFixIssues) {
  if (!postFixByCharge.has(i.batchId)) {
    postFixByCharge.set(i.batchId, { ...i, postFixQty: 0, orders: [] });
  }
  const e = postFixByCharge.get(i.batchId);
  e.postFixQty += i.postFixQty;
  e.orders.push({ name: i.orderName, qty: i.postFixQty });
}
for (const e of [...postFixByCharge.values()].sort(
  (a, b) => a.product.localeCompare(b.product) || a.charge_number.localeCompare(b.charge_number),
)) {
  const neu = typeof e.remaining === "number" ? e.remaining + e.postFixQty : "?";
  const corrected = correctedByBatch.get(e.batchId) ?? 0;
  const orders = e.orders.map((o) => `${o.name} (${o.qty})`).join(", ");
  csv.push(
    [
      e.product,
      e.variantTitle,
      e.sku,
      e.charge_number,
      e.batchId,
      e.variant_id,
      e.status,
      e.remaining,
      e.postFixQty,
      corrected,
      "ja",
      "POST-FIX",
      e.postFixQty,
      neu,
      e.fixAt,
      orders,
    ]
      .map(csvField)
      .join(";"),
  );
}
const postFixChargeCount = postFixByCharge.size;
const csvPath = "scripts/double-deduction-correction.csv";
writeFileSync(csvPath, csv.join("\n") + "\n");
console.log(`📄 CSV: ${csvPath}  (${offen.length} offen, ${postFixChargeCount} post-fix Chargen)\n`);

console.log("================ NACH Double#-KORREKTUR NOCHMAL ABGEZOGEN ================");
console.log("(Order hat auf derselben Charge nach der Korrektur erneut konsumiert — darf nicht)\n");
if (postFixIssues.length === 0) {
  console.log("  ✅ Keine Post-Fix-Wiederholungen auf korrigierten Chargen.\n");
} else {
  for (const i of postFixIssues.sort((a, b) => a.orderName.localeCompare(b.orderName))) {
    const prod = i.variantTitle ? `${i.product} – ${i.variantTitle}` : i.product;
    console.log(`${i.orderName.padEnd(8)}  Charge ${i.charge_number}  ·  ${prod}`);
    console.log(`   Korrektur: ${i.fixAt}  (${i.fixNotes})`);
    console.log(
      `   Consume-Cluster: ${i.clusterTimes.length} (${i.clusterTimes.join(", ")})  ` +
      `vor Fix=${i.preFixQty}  nach Fix=${i.postFixQty} ⚠️`,
    );
    console.log(`   batch=${i.batchId}  order=${i.orderId}\n`);
  }
}

console.log("================ Betroffene Orders (Übersicht, nur mit offenen Chargen) ================\n");
for (const a of affected.sort((x, y) => (x.confidence < y.confidence ? -1 : 1))) {
  const hasOpenBatch = Object.keys(a.wrongByBatch).some((id) => perCharge.has(id));
  if (!hasOpenBatch) continue;
  console.log(
    `${a.name.padEnd(8)} [${a.confidence}]  status=${a.status}  ` +
    `Consume-Cluster: ${a.clusterTimes.length} (${a.clusterTimes.join(", ")})  ` +
    `Überverbrauch=${a.over}  doppelt abgebucht=${a.wrongUnits} Einheiten`,
  );
}

// ---- 6. Summary ----
const offenUnits = offen.reduce((s, [, e]) => s + e.wrong, 0);
const openOrders = affected.filter((a) => Object.keys(a.wrongByBatch).some((id) => perCharge.has(id))).length;
console.log("\n================ Summary ================");
console.log(`  Double-Bewegungen (bereits korrigiert, ausgeblendet): ${doubleMovements}`);
console.log(`  Chargen mit Double#-Fix: ${doubleFixesByBatch.size}`);
console.log(`  ⚠️ Post-Fix-Wiederholungen: ${postFixIssues.length} Order×Charge / ${postFixChargeCount} Chargen`);
console.log(`  ➜ OFFEN: ${offenUnits} Einheiten / ${offen.length} Chargen / ${openOrders} Orders`);
console.log();
