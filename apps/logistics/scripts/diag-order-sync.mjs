// Find the gap between Shopify orders and Firestore orders.
// Run: node --env-file=.env.local scripts/diag-order-sync.mjs
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

console.log("\n=== Latest 10 orders in Firestore (by created_at_shopify desc) ===");
const fsSnap = await db
  .collection("orders")
  .orderBy("created_at_shopify", "desc")
  .limit(10)
  .get();
for (const d of fsSnap.docs) {
  const data = d.data();
  const ts =
    data.created_at_shopify?.toDate?.()?.toISOString?.() ??
    "?";
  console.log(
    `  ${data.name?.padEnd(8) ?? "?"}  ${data.internal_status?.padEnd(10) ?? "?"}  created=${ts}`,
  );
}

console.log("\n=== Latest 10 webhook events ===");
const whSnap = await db
  .collection("webhook_events")
  .orderBy("received_at", "desc")
  .limit(10)
  .get();
for (const d of whSnap.docs) {
  const data = d.data();
  const recv = data.received_at?.toDate?.()?.toISOString?.() ?? "?";
  console.log(
    `  ${recv}  ${data.topic?.padEnd(25) ?? "?"}  status=${data.status?.padEnd(10) ?? "?"}  err=${(data.error ?? "").slice(0, 60)}`,
  );
}

console.log("\n=== Latest 5 orders from Shopify (live query) ===");
const tokenSnap = await db.collection("config").doc("shopify_token").get();
const token = tokenSnap.data()?.access_token;
const shop = tokenSnap.data()?.shop_domain;
const metaSnap = await db.collection("config").doc("shopify_meta").get();
const apiVer = metaSnap.data()?.api_version ?? "2026-04";

if (!token || !shop) {
  console.log("  ⚠️ no token — cannot query Shopify");
} else {
  const res = await fetch(
    `https://${shop}/admin/api/${apiVer}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `{
          orders(first: 5, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id name createdAt
              displayFulfillmentStatus
              displayFinancialStatus
              cancelledAt
            }
          }
        }`,
      }),
    },
  );
  const json = await res.json();
  if (json.errors) {
    console.log("  Shopify error:", JSON.stringify(json.errors));
  } else {
    for (const n of json.data.orders.nodes) {
      const id = n.id.split("/").pop();
      const inFs = (await db.collection("orders").doc(id).get()).exists;
      console.log(
        `  ${n.name.padEnd(8)}  ${n.displayFulfillmentStatus?.padEnd(14)} ${n.displayFinancialStatus?.padEnd(10)}  created=${n.createdAt}  inFs=${inFs ? "YES" : "NO"}`,
      );
    }
  }
}
