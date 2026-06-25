// Push LAGER_STOP / LAGER_SHIP tags to Shopify for every STOP / SHIP order
// in Firestore — verifying that Shopify accepts each change. Use after a
// tag-push bug to bring Shopify back in sync.
//
// Run: node --env-file=.env.local scripts/sync-stop-tags.mjs
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();
const tokenSnap = await db.collection("config").doc("shopify_token").get();
const token = tokenSnap.data().access_token;
const shop = tokenSnap.data().shop_domain;
const apiVer = "2026-04";

async function gql(query, variables) {
  const res = await fetch(`https://${shop}/admin/api/${apiVer}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function syncOrder(orderId, gid, wantTag, removeTag) {
  // Read current
  const q = await gql(`query($id: ID!) { order(id: $id) { tags } }`, { id: gid });
  const live = new Set(q.data?.order?.tags ?? []);
  const needAdd = !live.has(wantTag);
  const needRem = live.has(removeTag);

  if (needAdd) {
    const r = await gql(
      `mutation($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
      }`,
      { id: gid, tags: [wantTag] },
    );
    const errs = r.data?.tagsAdd?.userErrors ?? [];
    if (errs.length) console.log(`  ❌ add ${wantTag}: ${JSON.stringify(errs)}`);
  }
  if (needRem) {
    const r = await gql(
      `mutation($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
      }`,
      { id: gid, tags: [removeTag] },
    );
    const errs = r.data?.tagsRemove?.userErrors ?? [];
    if (errs.length) console.log(`  ❌ rem ${removeTag}: ${JSON.stringify(errs)}`);
  }

  // Verify
  const q2 = await gql(`query($id: ID!) { order(id: $id) { tags } }`, { id: gid });
  const final = new Set(q2.data?.order?.tags ?? []);
  const ok = final.has(wantTag) && !final.has(removeTag);
  console.log(
    `  ${orderId}  ${ok ? "✅" : "⚠️"} tags=[${[...final].join(", ")}]`,
  );
}

for (const [status, wantTag, removeTag] of [
  ["STOP", "LAGER_STOP", "LAGER_SHIP"],
  ["SHIP", "LAGER_SHIP", "LAGER_STOP"],
]) {
  console.log(`\n=== Syncing ${status} orders ===`);
  const snap = await db
    .collection("orders")
    .where("internal_status", "==", status)
    .limit(200)
    .get();
  for (const d of snap.docs) {
    const data = d.data();
    await syncOrder(data.name, data.shopify_gid, wantTag, removeTag);
  }
}
console.log("\nDone.");
