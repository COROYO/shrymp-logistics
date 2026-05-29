// Brute-force repair for a single hanging order:
//   1. Load it from Firestore.
//   2. If still in NEW (allocation never decided) → re-allocate inline by
//      reading active batches and doing a single-order FEFO greedy. Writes
//      allocations + transitions to SHIP/STOP atomically.
//   3. Compute the tag Shopify SHOULD have based on internal_status.
//   4. Push tags directly via GraphQL with verification round-trip.
//   5. Patch the Firestore `tags` field so the UI shows the truth too.
//
// Run: node --env-file=.env.local scripts/force-fix-order.mjs 1173
import admin from "firebase-admin";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/force-fix-order.mjs <order-name-or-id>");
  process.exit(1);
}

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ---- 1. Resolve order ----
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
  console.error(`Order ${arg} nicht in Firestore.`);
  process.exit(2);
}
const orderId = orderDoc.id;
let order = orderDoc.data();
console.log(`\nOrder ${order.name} (${orderId}) → status=${order.internal_status}, tags=[${(order.tags ?? []).join(", ")}]`);

// ---- 2. If NEW, run single-order allocation inline ----
if (order.internal_status === "NEW") {
  console.log("→ Status NEW: führe inline-Allocation aus…");

  if (!order.line_items?.length) {
    console.log("  Order hat 0 line_items → STOP/EMPTY_ORDER");
    await orderDoc.ref.update({
      internal_status: "STOP",
      stop_reason: "EMPTY_ORDER",
      updated_at: FieldValue.serverTimestamp(),
    });
    order = (await orderDoc.ref.get()).data();
  } else {
    const variantIds = [...new Set(order.line_items.map((li) => li.variant_id))];

    // Active batches for these variants
    const batches = [];
    for (let i = 0; i < variantIds.length; i += 30) {
      const c = variantIds.slice(i, i + 30);
      const snap = await db
        .collection("batches")
        .where("variant_id", "in", c)
        .where("status", "==", "ACTIVE")
        .get();
      for (const d of snap.docs) {
        const b = d.data();
        if ((b.remaining_qty ?? 0) > 0) batches.push(b);
      }
    }

    // Subtract OTHER orders' open allocations
    const reservedByBatch = {};
    for (let i = 0; i < variantIds.length; i += 30) {
      const c = variantIds.slice(i, i + 30);
      const snap = await db
        .collection("allocations")
        .where("variant_id", "in", c)
        .get();
      for (const d of snap.docs) {
        const a = d.data();
        if (a.consumed_at) continue;
        if (a.order_id === orderId) continue;
        reservedByBatch[a.batch_id] = (reservedByBatch[a.batch_id] ?? 0) + a.qty;
      }
    }

    // FEFO pool
    const pool = new Map();
    for (const b of batches) {
      const expMs = b.expiry_date?.toMillis?.() ?? 0;
      const avail = b.remaining_qty - (reservedByBatch[b.id] ?? 0);
      if (avail <= 0) continue;
      const list = pool.get(b.variant_id) ?? [];
      list.push({ id: b.id, avail, expMs, charge: b.charge_number });
      pool.set(b.variant_id, list);
    }
    for (const list of pool.values()) {
      list.sort((a, b) => a.expMs - b.expMs || a.charge.localeCompare(b.charge));
    }

    const newAllocs = [];
    let canShip = true;
    let stopReason = "INSUFFICIENT_STOCK";
    for (const li of order.line_items) {
      let need = li.qty;
      const list = pool.get(li.variant_id) ?? [];
      if (list.length === 0) {
        canShip = false;
        stopReason = "UNKNOWN_VARIANT";
        break;
      }
      for (const e of list) {
        if (need === 0) break;
        const take = Math.min(e.avail, need);
        if (take > 0) {
          newAllocs.push({
            lineItemId: li.id,
            variantId: li.variant_id,
            batchId: e.id,
            qty: take,
          });
          e.avail -= take;
          need -= take;
        }
      }
      if (need > 0) {
        canShip = false;
        stopReason = "INSUFFICIENT_STOCK";
        break;
      }
    }

    if (canShip) {
      console.log(`  → SHIP, ${newAllocs.length} Allocations`);
      const batch = db.batch();
      for (const a of newAllocs) {
        const ref = db.collection("allocations").doc();
        batch.set(ref, {
          id: ref.id,
          order_id: orderId,
          line_item_id: a.lineItemId,
          variant_id: a.variantId,
          batch_id: a.batchId,
          qty: a.qty,
          run_id: "force-fix-order",
          created_at: FieldValue.serverTimestamp(),
        });
      }
      batch.update(orderDoc.ref, {
        internal_status: "SHIP",
        stop_reason: FieldValue.delete(),
        updated_at: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } else {
      console.log(`  → STOP (${stopReason})`);
      await orderDoc.ref.update({
        internal_status: "STOP",
        stop_reason: stopReason,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    order = (await orderDoc.ref.get()).data();
  }
}

// ---- 3. Decide expected tag ----
let wantTag = null;
let removeTags = [];
if (order.internal_status === "SHIP" || order.internal_status === "PICKING") {
  wantTag = "LAGER_SHIP";
  removeTags = ["LAGER_STOP", "LAGER_PACKED"];
} else if (order.internal_status === "STOP") {
  wantTag = "LAGER_STOP";
  removeTags = ["LAGER_SHIP", "LAGER_PACKED"];
} else if (order.internal_status === "PACKED") {
  wantTag = "LAGER_PACKED";
  removeTags = ["LAGER_SHIP", "LAGER_STOP"];
} else {
  console.log(`Status ${order.internal_status} braucht keinen Tag-Push. Fertig.`);
  process.exit(0);
}

// ---- 4. Direct GraphQL push with verification ----
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

const gid = order.shopify_gid;
console.log(`\n→ Push: add=[${wantTag}] remove=[${removeTags.join(", ")}] auf ${gid}`);

// Pre-state
const pre = await gql(`query($id:ID!){order(id:$id){tags}}`, { id: gid });
const preTags = pre.data?.order?.tags ?? [];
console.log(`  vor:   [${preTags.join(", ")}]`);

const addRes = await gql(
  `mutation($id:ID!,$tags:[String!]!){tagsAdd(id:$id,tags:$tags){userErrors{field message}}}`,
  { id: gid, tags: [wantTag] },
);
const addErr = addRes.data?.tagsAdd?.userErrors ?? [];
if (addErr.length) console.log(`  ❌ add ${wantTag}: ${JSON.stringify(addErr)}`);

if (removeTags.length) {
  const remRes = await gql(
    `mutation($id:ID!,$tags:[String!]!){tagsRemove(id:$id,tags:$tags){userErrors{field message}}}`,
    { id: gid, tags: removeTags },
  );
  const remErr = remRes.data?.tagsRemove?.userErrors ?? [];
  if (remErr.length) console.log(`  ❌ rem: ${JSON.stringify(remErr)}`);
}

// Verify
const post = await gql(`query($id:ID!){order(id:$id){tags}}`, { id: gid });
const liveTags = post.data?.order?.tags ?? [];
const ok = liveTags.includes(wantTag) && !removeTags.some((t) => liveTags.includes(t));
console.log(`  nach:  [${liveTags.join(", ")}]  ${ok ? "✅" : "⚠️"}`);

// ---- 5. Mirror tags into Firestore ----
await orderDoc.ref.update({
  tags: liveTags,
  updated_at: FieldValue.serverTimestamp(),
});
console.log(`\nFertig. Firestore tags synced.`);
