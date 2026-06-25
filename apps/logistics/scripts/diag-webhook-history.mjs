// Show ALL webhook events for the last 24h, with topic + status, to find
// gaps (missing orders/create deliveries).
// Run: node --env-file=.env.local scripts/diag-webhook-history.mjs
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

const cutoff = admin.firestore.Timestamp.fromDate(
  new Date(Date.now() - 24 * 3600 * 1000),
);

const snap = await db
  .collection("webhook_events")
  .where("received_at", ">=", cutoff)
  .orderBy("received_at", "desc")
  .get();

console.log(`\n=== Webhook events last 24h (${snap.docs.length} total) ===\n`);

const byTopic = {};
for (const d of snap.docs) {
  const data = d.data();
  byTopic[data.topic] = (byTopic[data.topic] ?? 0) + 1;
  const recv = data.received_at?.toDate?.()?.toISOString?.() ?? "?";
  console.log(
    `  ${recv}  ${data.topic.padEnd(28)}  ${data.status.padEnd(10)}  ${data.error?.slice(0, 60) ?? ""}`,
  );
}

console.log("\n=== By topic ===");
for (const [topic, count] of Object.entries(byTopic).sort()) {
  console.log(`  ${topic.padEnd(28)}  ${count}`);
}

// Look for orders/create gaps: list orders created in last 24h vs. those
// for which we have a corresponding webhook_event with topic=orders/create.
console.log("\n=== orders/create cross-check (last 24h) ===");
const orderSnap = await db
  .collection("orders")
  .where("created_at_shopify", ">=", cutoff)
  .orderBy("created_at_shopify", "desc")
  .get();

for (const o of orderSnap.docs) {
  const data = o.data();
  const orderId = data.id;
  // Look for any webhook event whose body would have mentioned this order.
  // We don't store the body, but we can at least see if there were
  // orders/* events around the creation time.
  console.log(
    `  ${data.name.padEnd(8)}  created=${data.created_at_shopify?.toDate?.()?.toISOString?.() ?? "?"}  status=${data.internal_status}  id=${orderId}`,
  );
}
