// Force-mirror a single Shopify order into Firestore. Bypasses the
// fulfillment-status filter that the normal backfill uses, so it works
// for any order regardless of state.
// Run: node --env-file=.env.local scripts/force-mirror-order.mjs <orderName>
//   e.g. node --env-file=.env.local scripts/force-mirror-order.mjs 1158
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

const argName = process.argv[2];
if (!argName) {
  console.log("usage: node scripts/force-mirror-order.mjs <orderNameOrId>");
  process.exit(1);
}

const tokenSnap = await db.collection("config").doc("shopify_token").get();
const token = tokenSnap.data()?.access_token;
const shop = tokenSnap.data()?.shop_domain;
const metaSnap = await db.collection("config").doc("shopify_meta").get();
const apiVer = metaSnap.data()?.api_version ?? "2026-04";

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
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// Search by name
const search = await gql(
  `query($q: String!) {
    orders(first: 1, query: $q) {
      nodes {
        id name createdAt cancelledAt
        displayFinancialStatus displayFulfillmentStatus
      }
    }
  }`,
  { q: `name:${argName.startsWith("#") ? argName : "#" + argName}` },
);

const order = search.orders.nodes[0];
if (!order) {
  console.log(`not found in Shopify: ${argName}`);
  process.exit(1);
}

console.log(`Found ${order.name} (${order.id})`);
console.log(`  created: ${order.createdAt}`);
console.log(`  fulfillment: ${order.displayFulfillmentStatus}`);
console.log(`  cancelled: ${order.cancelledAt ?? "no"}`);

const numericId = order.id.split("/").pop();
const docRef = db.collection("orders").doc(numericId);
const before = await docRef.get();
console.log(`  in FS before: ${before.exists ? "YES" : "NO"}`);

// Trigger a sync by hitting the same code path the webhook would.
// We use the GraphQL backfill helper, which already handles bundle info +
// current quantities correctly.
const r = await fetch(
  process.env.APP_BASE_URL?.replace(/\/$/, "") + "/api/_admin/force-mirror",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: numericId, secret: process.env.CRON_SECRET }),
  },
).catch((e) => ({ ok: false, status: 0, statusText: String(e) }));

console.log(`\nServer endpoint: ${r.status} ${r.statusText ?? ""}`);
if (r.ok === false && r.status === 0) {
  console.log(
    "  (endpoint not reachable from this shell — falling back to direct Firestore write)",
  );
}

// Direct fallback: pull full order from GraphQL and write to Firestore.
const full = await gql(
  `query($id: ID!) {
    order(id: $id) {
      id name tags createdAt updatedAt cancelledAt cancelReason
      displayFinancialStatus displayFulfillmentStatus
      currencyCode note email
      customer { id email firstName lastName }
      totalOutstandingSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      shippingLines(first: 5) { nodes { title code } }
      shippingAddress {
        firstName lastName company address1 address2
        zip city country countryCodeV2 phone
      }
      lineItems(first: 250) {
        nodes {
          id title sku quantity
          variant { id }
          lineItemGroup { id productId variantId variantSku title quantity }
        }
      }
    }
  }`,
  { id: order.id },
);

const n = full.order;
const numId = (gid) => gid.split("/").pop();
const moneyToCents = (v) => {
  if (!v) return null;
  const x = Number.parseFloat(v);
  return Number.isFinite(x) ? Math.round(x * 100) : null;
};

const prev = before.exists ? before.data() : null;
const cancelled = !!n.cancelledAt;
const internalStatus = cancelled ? "CANCELLED" : prev?.internal_status ?? "NEW";

const doc = {
  id: numericId,
  shopify_gid: n.id,
  name: n.name,
  tags: n.tags ?? [],
  shipping_address: n.shippingAddress
    ? {
        first_name: n.shippingAddress.firstName,
        last_name: n.shippingAddress.lastName,
        company: n.shippingAddress.company,
        address1: n.shippingAddress.address1,
        address2: n.shippingAddress.address2,
        zip: n.shippingAddress.zip,
        city: n.shippingAddress.city,
        country: n.shippingAddress.country,
        country_code: n.shippingAddress.countryCodeV2,
        phone: n.shippingAddress.phone,
      }
    : null,
  shipping_method:
    n.shippingLines.nodes[0]?.title
      ? {
          title: n.shippingLines.nodes[0].title,
          code: n.shippingLines.nodes[0].code ?? null,
        }
      : null,
  line_items: n.lineItems.nodes
    .filter((li) => li.variant?.id && li.quantity > 0)
    .map((li) => {
      const out = {
        id: numId(li.id),
        variant_id: numId(li.variant.id),
        variant_gid: li.variant.id,
        qty: li.quantity,
        title: li.title,
        sku: li.sku ?? null,
      };
      if (li.lineItemGroup) {
        out.bundle = {
          group_id: numId(li.lineItemGroup.id),
          product_id: li.lineItemGroup.productId
            ? numId(li.lineItemGroup.productId)
            : null,
          variant_id: li.lineItemGroup.variantId
            ? numId(li.lineItemGroup.variantId)
            : null,
          variant_sku: li.lineItemGroup.variantSku ?? null,
          title: li.lineItemGroup.title,
          quantity: li.lineItemGroup.quantity,
        };
      }
      return out;
    }),
  shopify_financial_status: n.displayFinancialStatus ?? null,
  shopify_fulfillment_status: n.displayFulfillmentStatus ?? null,
  internal_status: internalStatus,
  cod_amount_cents:
    moneyToCents(n.totalOutstandingSet?.shopMoney?.amount) ??
    moneyToCents(n.currentTotalPriceSet?.shopMoney?.amount),
  currency:
    n.currencyCode ?? n.totalOutstandingSet?.shopMoney?.currencyCode ?? null,
  customer_note: n.note?.trim() ? n.note.trim() : null,
  customer: n.customer
    ? {
        shopify_id: n.customer.id ? numId(n.customer.id) : null,
        email:
          (n.customer.email ?? n.email)?.trim()?.toLowerCase() ?? null,
        first_name: n.customer.firstName ?? null,
        last_name: n.customer.lastName ?? null,
      }
    : null,
  total_price_cents: moneyToCents(
    n.currentTotalPriceSet?.shopMoney?.amount,
  ),
  ...(n.cancelledAt
    ? {
        cancelled_at: new Date(n.cancelledAt),
        cancel_reason: n.cancelReason ?? null,
      }
    : {}),
  created_at_shopify: new Date(n.createdAt),
  updated_at: admin.firestore.FieldValue.serverTimestamp(),
};

await docRef.set(doc, { merge: false });
console.log(`✅ Wrote ${numericId} to Firestore (status=${internalStatus})`);
