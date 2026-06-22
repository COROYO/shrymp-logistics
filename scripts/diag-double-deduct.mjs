// READ-ONLY. Verify the double-deduction hypothesis for one order.
//
// Shows, for a given order:
//   - current order state (status, packed_at, externally_fulfilled, updated_at)
//   - ALL allocations with full created_at / consumed_at timestamps + run_id
//   - SALE rows (consumed && !released) grouped by consume-time → reveals if the
//     same demand was consumed in TWO separate clusters (= double "Verkauf")
//   - CONSUME inventory_movements (written only by warehouse confirmPacking,
//     NOT by external-fulfillment) → tells which path consumed each time
//   - recent allocation_runs around the order's timeline
//
// Run: node --env-file=.env.local scripts/diag-double-deduct.mjs 1382
import admin from "firebase-admin";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/diag-double-deduct.mjs <order-name-or-id>");
  process.exit(1);
}
if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

const iso = (ts) => ts?.toDate?.()?.toISOString?.() ?? (ts ? String(ts) : "—");
const minuteBucket = (ts) => {
  const d = ts?.toDate?.();
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : "—";
};

// ---- resolve order ----
let orderDoc = await db.collection("orders").doc(arg).get();
if (!orderDoc.exists) {
  for (const cand of [`#${arg}`, arg]) {
    const q = await db.collection("orders").where("name", "==", cand).limit(1).get();
    if (!q.empty) { orderDoc = q.docs[0]; break; }
  }
}
if (!orderDoc.exists) {
  console.error(`Order ${arg} nicht in Firestore gefunden.`);
  process.exit(2);
}
const order = orderDoc.data();

console.log(`\n=== Order ${order.name} (${orderDoc.id}) ===`);
console.log(`  internal_status:     ${order.internal_status}`);
console.log(`  fulfillment_status:  ${order.shopify_fulfillment_status ?? "—"}`);
console.log(`  externally_fulfilled:${order.externally_fulfilled ? " true" : " —"}`);
console.log(`  packed_at:           ${iso(order.packed_at)}  by=${order.packed_by_uid ?? "—"}`);
console.log(`  updated_at:          ${iso(order.updated_at)}`);
console.log(`  allocation_run_id:   ${order.allocation_run_id ?? "—"}`);
console.log(`  cancelled_at:        ${iso(order.cancelled_at)}`);

// expected demand per variant
const demand = {};
for (const li of order.line_items ?? []) {
  demand[li.variant_id] = (demand[li.variant_id] ?? 0) + li.qty;
}
console.log(`  line_items (Soll-Bedarf):`);
for (const li of order.line_items ?? []) {
  console.log(`    · ${li.qty}× ${li.title}  (variant=${li.variant_id})`);
}

// ---- allocations ----
const allocSnap = await db.collection("allocations").where("order_id", "==", orderDoc.id).get();
const allocs = allocSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
allocs.sort((a, b) => (a.created_at?.toMillis?.() ?? 0) - (b.created_at?.toMillis?.() ?? 0));

console.log(`\n=== Allocations (${allocs.length}) — chronologisch ===`);
for (const a of allocs) {
  console.log(
    `  created=${iso(a.created_at)}  consumed=${iso(a.consumed_at)}  released=${a.released ? "↩" : "—"}  ` +
    `${a.qty}× variant=${a.variant_id}  batch=${String(a.batch_id).slice(0, 10)}  run=${a.run_id}`,
  );
}

// ---- SALE rows: consumed && !released, grouped by consume-time bucket ----
const sales = allocs.filter((a) => a.consumed_at && !a.released);
const byConsume = {};
for (const a of sales) {
  const k = minuteBucket(a.consumed_at);
  (byConsume[k] ??= []).push(a);
}
const consumeTimes = Object.keys(byConsume).sort();
console.log(`\n=== "Verkauf"-Buchungen (consumed && !released) → ${consumeTimes.length} Zeit-Cluster ===`);
for (const t of consumeTimes) {
  const rows = byConsume[t];
  const perVariant = {};
  for (const a of rows) perVariant[a.variant_id] = (perVariant[a.variant_id] ?? 0) + a.qty;
  const summary = Object.entries(perVariant).map(([v, q]) => `${q}× ${v}`).join(", ");
  console.log(`  • ${t}  →  ${summary}`);
}

// ---- verdict: consumed total per variant vs expected demand ----
console.log(`\n=== Soll vs. tatsächlich verbraucht (consumed, !released) ===`);
const consumedPerVariant = {};
for (const a of sales) consumedPerVariant[a.variant_id] = (consumedPerVariant[a.variant_id] ?? 0) + a.qty;
let doubled = false;
for (const v of new Set([...Object.keys(demand), ...Object.keys(consumedPerVariant)])) {
  const soll = demand[v] ?? 0;
  const ist = consumedPerVariant[v] ?? 0;
  const flag = ist > soll ? `  ⚠️ ÜBERVERBRAUCH (+${ist - soll})` : "";
  if (ist > soll) doubled = true;
  console.log(`  variant=${v}:  Soll=${soll}  verbraucht=${ist}${flag}`);
}
console.log(
  `\n  VERDIKT: ${doubled
    ? "⚠️ DOPPEL-ABZUG bestätigt — mehr verbraucht als bestellt."
    : consumeTimes.length > 1
      ? "⚠️ Mehrere Consume-Cluster — prüfe Zeitstempel oben."
      : "kein Überverbrauch in den Allocations sichtbar."}`,
);

// ---- CONSUME inventory_movements for this order (warehouse-pack path only) ----
const movSnap = await db
  .collection("inventory_movements")
  .where("type", "==", "CONSUME")
  .get();
const movs = movSnap.docs
  .map((d) => d.data())
  .filter((m) => m.ref?.kind === "ORDER" && String(m.ref?.id) === orderDoc.id);
movs.sort((a, b) => (a.created_at?.toMillis?.() ?? 0) - (b.created_at?.toMillis?.() ?? 0));
console.log(`\n=== CONSUME inventory_movements (nur confirmPacking schreibt diese) — ${movs.length} ===`);
for (const m of movs) {
  console.log(`  ${iso(m.created_at)}  qty=${m.qty}  variant=${m.variant_id}  batch=${String(m.batch_id).slice(0, 10)}  by=${m.user_id ?? "—"}`);
}
console.log(`  (0 = via externer Fulfillment-Pfad konsumiert; >1 Cluster hier = doppeltes Packen)`);

// ---- allocation_runs around the order timeline ----
console.log(`\n=== Letzte 12 allocation_runs ===`);
const runsSnap = await db.collection("allocation_runs").orderBy("started_at", "desc").limit(12).get();
for (const d of runsSnap.docs) {
  const r = d.data();
  console.log(
    `  start=${iso(r.started_at)}  fin=${iso(r.finished_at)}  ${r.status}  trig=${r.triggered_by}  ship=${r.stats?.ship_count ?? "?"} stop=${r.stats?.stop_count ?? "?"}  id=${d.id.slice(0, 10)}`,
  );
}

console.log();
