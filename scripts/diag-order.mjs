// Diagnose a specific order: Firestore state, allocations, outbox rows, and
// live Shopify tags. Use to figure out why an order is "hanging" without
// tags or status updates.
//
// Run: node --env-file=.env.local scripts/diag-order.mjs 1173
//   (pass either the Shopify order name like "1173" or the doc id)
import admin from "firebase-admin";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/diag-order.mjs <order-name-or-id>");
  process.exit(1);
}

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

// Resolve to order doc — try doc id first, then `name` field with/without "#".
let orderDoc = await db.collection("orders").doc(arg).get();
if (!orderDoc.exists) {
  for (const candidate of [`#${arg}`, arg]) {
    const q = await db
      .collection("orders")
      .where("name", "==", candidate)
      .limit(1)
      .get();
    if (!q.empty) {
      orderDoc = q.docs[0];
      break;
    }
  }
}
if (!orderDoc.exists) {
  console.error(`Order ${arg} nicht in Firestore gefunden.`);
  process.exit(2);
}

const order = orderDoc.data();
console.log(`\n=== Order ${order.name} (${orderDoc.id}) ===`);
console.log(`  internal_status:  ${order.internal_status}`);
console.log(`  fulfillment:      ${order.shopify_fulfillment_status ?? "—"}`);
console.log(`  tags (Firestore): [${(order.tags ?? []).join(", ")}]`);
console.log(`  stop_reason:      ${order.stop_reason ?? "—"}`);
console.log(`  allocation_run:   ${order.allocation_run_id ?? "—"}`);
console.log(
  `  created_at:       ${order.created_at_shopify?.toDate?.()?.toISOString?.() ?? "?"}`,
);
console.log(
  `  updated_at:       ${order.updated_at?.toDate?.()?.toISOString?.() ?? "?"}`,
);
console.log(`  line_items:       ${order.line_items?.length ?? 0}`);
for (const li of order.line_items ?? []) {
  console.log(`    · ${li.qty}× ${li.title}  (variant=${li.variant_id}, sku=${li.sku ?? "—"})`);
}

// Allocations for this order
const allocSnap = await db
  .collection("allocations")
  .where("order_id", "==", orderDoc.id)
  .get();
console.log(`\n=== Allocations (${allocSnap.size}) ===`);
for (const d of allocSnap.docs) {
  const a = d.data();
  console.log(
    `  ${a.qty}× variant=${a.variant_id}  batch=${a.batch_id.slice(0, 8)}  run=${a.run_id.slice(0, 8)}  consumed=${a.consumed_at ? "✅" : "—"}  released=${a.released ? "↩" : "—"}`,
  );
}

// Outbox rows referencing this order
console.log(`\n=== Outbox rows ===`);
const outboxSnap = await db
  .collection("shopify_outbox")
  .orderBy("created_at", "desc")
  .limit(200)
  .get();
let hit = 0;
for (const d of outboxSnap.docs) {
  const data = d.data();
  const payload = data.payload ?? {};
  const orderRef = payload.orderId ?? "";
  if (
    String(orderRef) === orderDoc.id ||
    String(orderRef) === order.shopify_gid ||
    String(orderRef) === order.shopify_gid?.split("/").pop()
  ) {
    hit++;
    const created = data.created_at?.toDate?.()?.toISOString?.() ?? "?";
    const done = data.done_at?.toDate?.()?.toISOString?.() ?? null;
    console.log(
      `  ${created}  ${data.op.padEnd(20)}  done=${done ? "✅" : "—"}  attempts=${data.attempts}  err=${(data.last_error ?? "").slice(0, 90)}`,
    );
  }
}
if (hit === 0)
  console.log(
    "  (keine — Allocation hat den Tag-Push für diese Order nie enqueued)",
  );

// Recent allocation_runs (helpful to see when the last one was, and if this order's id is in it)
console.log(`\n=== Letzte 5 allocation_runs ===`);
const runsSnap = await db
  .collection("allocation_runs")
  .orderBy("started_at", "desc")
  .limit(5)
  .get();
for (const d of runsSnap.docs) {
  const r = d.data();
  const started = r.started_at?.toDate?.()?.toISOString?.() ?? "?";
  const finished = r.finished_at?.toDate?.()?.toISOString?.() ?? "—";
  console.log(
    `  ${started}  ${d.id.slice(0, 10)}  ${r.status}  trig=${r.triggered_by}  ship=${r.stats?.ship_count ?? "?"} stop=${r.stats?.stop_count ?? "?"}  finished=${finished}`,
  );
}

// Live Shopify tags
const tokenSnap = await db.collection("config").doc("shopify_token").get();
const token = tokenSnap.data()?.access_token;
const shop = tokenSnap.data()?.shop_domain;
const apiVer = "2026-04";
if (token && shop && order.shopify_gid) {
  const res = await fetch(`https://${shop}/admin/api/${apiVer}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query($id: ID!) { order(id: $id) { tags fulfillmentOrders(first:5){ nodes { id status } } } }`,
      variables: { id: order.shopify_gid },
    }),
  });
  const j = await res.json();
  const liveTags = j.data?.order?.tags ?? [];
  console.log(`\n=== Shopify live state ===`);
  console.log(`  Tags:             [${liveTags.join(", ")}]`);
  for (const fo of j.data?.order?.fulfillmentOrders?.nodes ?? []) {
    console.log(`  FulfillmentOrder: ${fo.id.split("/").pop()} → ${fo.status}`);
  }
}

console.log();
