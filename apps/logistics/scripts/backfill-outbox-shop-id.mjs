// Backfill missing shop_id on pending shopify_outbox rows and reset for retry.
//
// Run: node --env-file=.env.local scripts/backfill-outbox-shop-id.mjs
// Apply: node --env-file=.env.local scripts/backfill-outbox-shop-id.mjs --apply
import admin from "firebase-admin";

function initAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "FIREBASE_PROJECT_ID is required. Add it to apps/logistics/.env.local.",
    );
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    let s = raw;
    if (
      (s.startsWith("'") && s.endsWith("'")) ||
      (s.startsWith('"') && s.endsWith('"'))
    ) {
      s = s.slice(1, -1);
    }
    const json = JSON.parse(s);
    if (
      typeof json.private_key === "string" &&
      !json.private_key.includes("\n") &&
      json.private_key.includes("\\n")
    ) {
      json.private_key = json.private_key.replaceAll("\\n", "\n");
    }
    admin.initializeApp({
      credential: admin.credential.cert(json),
      projectId,
    });
    return;
  }

  admin.initializeApp({ projectId });
}

function parseVariantId(uri) {
  if (typeof uri !== "string") return null;
  const match = uri.match(/:\/\/variant\/([^/]+)\//);
  return match?.[1] ?? null;
}

initAdmin();
const db = admin.firestore();
const apply = process.argv.includes("--apply");

const snap = await db.collection("shopify_outbox").limit(2000).get();
let pending = 0;
let backfilled = 0;
let reset = 0;
let unresolved = 0;
const unresolvedIds = [];
const batch = db.batch();
const now = admin.firestore.Timestamp.now();

for (const d of snap.docs) {
  const data = d.data();
  if (data.done_at) continue;
  pending++;

  let shopId = data.shop_id?.trim() || null;

  if (!shopId && data.payload?.orderId) {
    const orderSnap = await db.collection("orders").doc(data.payload.orderId).get();
    shopId = orderSnap.data()?.shop_id?.trim() || null;
  }

  if (!shopId && data.op === "INVENTORY_SET") {
    const variantId = parseVariantId(data.payload?.referenceDocumentUri);
    if (variantId) {
      const vSnap = await db.collection("variants").doc(variantId).get();
      shopId = vSnap.data()?.shop_id?.trim() || null;
    }
    if (!shopId) {
      const gid = data.payload?.setQuantities?.[0]?.inventoryItemId;
      if (gid) {
        const vSnap = await db
          .collection("variants")
          .where("inventory_item_gid", "==", gid)
          .limit(1)
          .get();
        shopId = vSnap.docs[0]?.data()?.shop_id?.trim() || null;
      }
    }
  }

  if (!shopId) {
    unresolved++;
    unresolvedIds.push(d.id);
    continue;
  }

  const patch = {
    attempts: 0,
    next_retry_at: now,
    last_error: admin.firestore.FieldValue.delete(),
  };
  if (shopId !== data.shop_id) {
    patch.shop_id = shopId;
    backfilled++;
  }
  if (data.last_error || (data.attempts ?? 0) > 0) reset++;

  if (apply) batch.update(d.ref, patch);
}

console.log(`Pending rows: ${pending}`);
console.log(`Would backfill shop_id: ${backfilled}`);
console.log(`Would reset for retry: ${reset}`);
if (unresolved > 0) {
  console.log(`Unresolved (no shop_id derivable): ${unresolved}`);
  for (const id of unresolvedIds) console.log(`  ${id}`);
}
if (!apply) {
  console.log("\nDry run. Pass --apply to write.");
} else if (pending > 0) {
  await batch.commit();
  console.log("\n✅ Backfilled + reset. outbox-retry cron drains them.");
}
