// Delete ALL Shopify webhook subscriptions for this app.
// Useful when subscriptions are stuck in a bad state — after delete,
// click "Webhooks registrieren" in /admin/settings to recreate them fresh.
//
// Run: node --env-file=.env.local scripts/delete-all-webhooks.mjs
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

const tokenSnap = await db.collection("config").doc("shopify_token").get();
const token = tokenSnap.data()?.access_token;
const shop = tokenSnap.data()?.shop_domain;
const metaSnap = await db.collection("config").doc("shopify_meta").get();
const apiVer = metaSnap.data()?.api_version ?? "2026-04";

if (!token || !shop) {
  console.log("⚠️ no token");
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch(
    `https://${shop}/admin/api/${apiVer}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const list = await gql(`{
  webhookSubscriptions(first: 50) {
    nodes {
      id topic
      endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
    }
  }
}`);

console.log(`Found ${list.webhookSubscriptions.nodes.length} subs:`);
for (const n of list.webhookSubscriptions.nodes) {
  console.log(`  ${n.topic.padEnd(28)}  ${n.endpoint?.callbackUrl ?? "?"}`);
}

console.log("\nDeleting…");
let deleted = 0;
let errors = 0;
for (const n of list.webhookSubscriptions.nodes) {
  const d = await gql(
    `mutation($id: ID!) {
      webhookSubscriptionDelete(id: $id) {
        deletedWebhookSubscriptionId
        userErrors { field message }
      }
    }`,
    { id: n.id },
  );
  if (d.webhookSubscriptionDelete.userErrors?.length) {
    console.log(
      `  ❌ ${n.topic} (${n.id}): ${JSON.stringify(d.webhookSubscriptionDelete.userErrors)}`,
    );
    errors++;
  } else {
    console.log(`  ✅ ${n.topic}`);
    deleted++;
  }
}

console.log(`\nDone. Deleted: ${deleted}, errors: ${errors}`);
console.log(
  "\nNext: go to /admin/settings → 'Webhooks registrieren' to recreate them with the current callback URL.",
);
