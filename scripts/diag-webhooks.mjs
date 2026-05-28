// Show currently-registered webhook subscriptions in Shopify, plus any
// HMAC-failed events that never made it into webhook_events.
// Run: node --env-file=.env.local scripts/diag-webhooks.mjs
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

console.log(`shop: ${shop}, api: ${apiVer}`);

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
        webhookSubscriptions(first: 50) {
          nodes {
            id
            topic
            createdAt
            endpoint {
              __typename
              ... on WebhookHttpEndpoint { callbackUrl }
            }
          }
        }
      }`,
    }),
  },
);
const json = await res.json();
if (json.errors) {
  console.log("Shopify error:", JSON.stringify(json.errors));
  process.exit(1);
}

console.log("\n=== Registered webhook subscriptions ===");
const expected = process.env.APP_BASE_URL?.replace(/\/$/, "") + "/api/webhooks/shopify";
console.log(`Expected callback: ${expected}\n`);

for (const n of json.data.webhookSubscriptions.nodes) {
  const url = n.endpoint?.callbackUrl ?? "?";
  const match = url === expected ? "✅" : "❌ WRONG URL";
  console.log(
    `  ${n.topic.padEnd(28)}  ${match}  ${url}`,
  );
}

console.log("\n=== Health doc ===");
const h = await db.collection("config").doc("shopify_health").get();
if (h.exists) {
  const d = h.data();
  console.log(
    `  checkedAt: ${d.checkedAt?.toDate?.()?.toISOString?.() ?? "?"}`,
  );
  console.log(`  ok: ${d.ok}`);
  console.log(`  tokenValid: ${d.tokenValid}`);
  if (d.errors?.length) console.log(`  errors: ${JSON.stringify(d.errors)}`);
} else {
  console.log("  no health doc yet");
}
