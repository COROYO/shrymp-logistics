// Delete and recreate the ORDERS_CREATE webhook subscription. Use when
// the subscription is registered but Shopify isn't actually delivering
// events to it (we get orders/updated but never orders/create).
//
// Run: node --env-file=.env.local scripts/recreate-orders-create-webhook.mjs
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

const callbackUrl = `${process.env.APP_BASE_URL?.replace(/\/$/, "")}/api/webhooks/shopify`;
console.log(`Target callback: ${callbackUrl}\n`);

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

// 1. List ORDERS_CREATE subs
const list = await gql(`{
  webhookSubscriptions(first: 50, topics: [ORDERS_CREATE]) {
    nodes {
      id topic createdAt
      endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
    }
  }
}`);

console.log(`Found ${list.webhookSubscriptions.nodes.length} ORDERS_CREATE subs:`);
for (const n of list.webhookSubscriptions.nodes) {
  console.log(
    `  ${n.id}  callback=${n.endpoint?.callbackUrl}  created=${n.createdAt}`,
  );
}

// 2. Delete all of them
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
    console.log(`  delete error: ${JSON.stringify(d.webhookSubscriptionDelete.userErrors)}`);
  } else {
    console.log(`  ✅ deleted ${n.id}`);
  }
}

// 3. Re-create fresh
const c = await gql(
  `mutation($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }`,
  {
    topic: "ORDERS_CREATE",
    input: { callbackUrl, format: "JSON" },
  },
);

if (c.webhookSubscriptionCreate.userErrors?.length) {
  console.log(
    `❌ create error: ${JSON.stringify(c.webhookSubscriptionCreate.userErrors)}`,
  );
  process.exit(1);
}

console.log(
  `\n✅ Fresh ORDERS_CREATE sub: ${c.webhookSubscriptionCreate.webhookSubscription.id}`,
);
console.log(
  "Next test order in Shopify should now fire orders/create here.",
);
