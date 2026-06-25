// Show recent TAGS_ADD / TAGS_REMOVE outbox entries with their state +
// last_error. Also list orders currently in STOP status whose Shopify
// tags would be expected to contain LAGER_STOP.
//
// Run: node --env-file=.env.local scripts/diag-tag-outbox.mjs
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

console.log("=== Latest 30 outbox rows ===");
const snap = await db
  .collection("shopify_outbox")
  .orderBy("created_at", "desc")
  .limit(30)
  .get();
for (const d of snap.docs) {
  const data = d.data();
  const created = data.created_at?.toDate?.()?.toISOString?.() ?? "?";
  const done = data.done_at?.toDate?.()?.toISOString?.() ?? null;
  console.log(
    `  ${created}  ${data.op.padEnd(20)}  done=${done ? "✅" : "—"}  attempts=${data.attempts}  payload=${JSON.stringify(data.payload).slice(0, 80)}  err=${(data.last_error ?? "").slice(0, 100)}`,
  );
}

console.log("\n=== STOP orders + their Shopify tags ===");
const stopSnap = await db
  .collection("orders")
  .where("internal_status", "==", "STOP")
  .limit(20)
  .get();

const tokenSnap = await db.collection("config").doc("shopify_token").get();
const token = tokenSnap.data()?.access_token;
const shop = tokenSnap.data()?.shop_domain;
const metaSnap = await db.collection("config").doc("shopify_meta").get();
const apiVer = metaSnap.data()?.api_version ?? "2026-04";

for (const o of stopSnap.docs) {
  const data = o.data();
  // Live-fetch tags from Shopify
  const res = await fetch(
    `https://${shop}/admin/api/${apiVer}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `query($id: ID!) { order(id: $id) { tags } }`,
        variables: { id: data.shopify_gid },
      }),
    },
  );
  const j = await res.json();
  const liveTags = j.data?.order?.tags ?? [];
  const hasStop = liveTags.includes("LAGER_STOP");
  console.log(
    `  ${data.name.padEnd(8)}  shopifyTags=[${liveTags.join(", ")}]  LAGER_STOP=${hasStop ? "✅" : "❌"}`,
  );
}
