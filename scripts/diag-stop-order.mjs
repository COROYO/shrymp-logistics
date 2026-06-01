// Why is an order STOP despite stock? For each line-item variant, compare the
// cached `reserved_total` against the TRUE reservation (Σ demand of SHIP +
// PICKING orders) and show what the allocation actually has available.
//
// Run: node --env-file=.env.local scripts/diag-stop-order.mjs 1182
import admin from "firebase-admin";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/diag-stop-order.mjs <order-name-or-id>");
  process.exit(1);
}
if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

// Resolve order
let orderDoc = await db.collection("orders").doc(arg).get();
if (!orderDoc.exists) {
  for (const c of [`#${arg}`, arg]) {
    const q = await db.collection("orders").where("name", "==", c).limit(1).get();
    if (!q.empty) { orderDoc = q.docs[0]; break; }
  }
}
if (!orderDoc.exists) { console.error("not found"); process.exit(2); }
const order = orderDoc.data();
console.log(`\nOrder ${order.name} — status=${order.internal_status}, stop_reason=${order.stop_reason ?? "—"}`);

// True reservation per variant = Σ demand over SHIP + PICKING orders.
// Locked (PICKING only) = what the allocation must not touch.
const trueReserved = {};
const lockedPicking = {};
for (const status of ["SHIP", "PICKING"]) {
  const snap = await db.collection("orders").where("internal_status", "==", status).get();
  for (const d of snap.docs) {
    for (const li of d.data().line_items ?? []) {
      trueReserved[li.variant_id] = (trueReserved[li.variant_id] ?? 0) + li.qty;
      if (status === "PICKING")
        lockedPicking[li.variant_id] = (lockedPicking[li.variant_id] ?? 0) + li.qty;
    }
  }
}

console.log(`\nPer line item:`);
for (const li of order.line_items ?? []) {
  const vSnap = await db.collection("variants").doc(li.variant_id).get();
  const v = vSnap.exists ? vSnap.data() : null;
  if (!v) {
    console.log(`  ✗ ${li.title} (variant ${li.variant_id}) — VARIANT FEHLT → UNKNOWN_VARIANT`);
    continue;
  }
  const onHand = v.on_hand_total ?? 0;
  const cachedReserved = v.reserved_total ?? 0;
  const truth = trueReserved[li.variant_id] ?? 0;
  const locked = lockedPicking[li.variant_id] ?? 0;
  const availOld = onHand - cachedReserved; // alte (cache-basierte) Rechnung, grob
  const availNew = onHand - locked;          // neue (live) Rechnung
  const drift = cachedReserved - truth;
  console.log(
    `  ${li.title}  (SKU ${li.sku ?? "—"})\n` +
    `     bestellt=${li.qty}  onHand=${onHand}  reserved_total(cache)=${cachedReserved}  reserved(wahr=SHIP+PICKING)=${truth}  PICKING-locked=${locked}` +
    (drift !== 0 ? `  ⚠️ DRIFT=${drift > 0 ? "+" : ""}${drift}` : "") +
    `\n     available ALT(cache)=${availOld}   available NEU(live)=${availNew}   → ${availNew >= li.qty ? "✅ reicht" : "❌ zu wenig"}`,
  );
}
console.log();
