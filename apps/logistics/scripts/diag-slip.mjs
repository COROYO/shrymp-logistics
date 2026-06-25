// Diagnose why packing-slip assignment fails for an order.
// Run: node --env-file=.env.local scripts/diag-slip.mjs 1222
import admin from "firebase-admin";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/diag-slip.mjs <order-name-or-id>");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    ),
  });
}
const db = admin.firestore();

function berlinYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}
function ymdToOrdinal(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
function toMs(ts) {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}
function isBatchExpired(expiry, ref = new Date()) {
  const expOrd = ymdToOrdinal(berlinYmd(toMs(expiry)));
  const refOrd = ymdToOrdinal(berlinYmd(ref.getTime()));
  return expOrd - refOrd < 0;
}
function isBatchAssignable(expiry, minDays, ref = new Date()) {
  const days = ymdToOrdinal(berlinYmd(toMs(expiry))) - ymdToOrdinal(berlinYmd(ref.getTime()));
  if (days < 0) return false;
  return days > minDays;
}

let orderDoc = await db.collection("orders").doc(arg).get();
if (!orderDoc.exists) {
  for (const candidate of [`#${arg}`, arg]) {
    const q = await db.collection("orders").where("name", "==", candidate).limit(1).get();
    if (!q.empty) {
      orderDoc = q.docs[0];
      break;
    }
  }
}
if (!orderDoc.exists) {
  console.error("Order not found");
  process.exit(2);
}

const order = orderDoc.data();
const orderId = orderDoc.id;
const cfg = (await db.collection("config").doc("lager").get()).data();
const minDays = cfg?.batch_min_days_before_expiry ?? 3;

console.log(`\n=== Slip diag ${order.name} (${orderId}) ===`);
console.log(`status=${order.internal_status} stop=${order.stop_reason ?? "—"}`);

const allocs = await db.collection("allocations").where("order_id", "==", orderId).get();
console.log(`open allocations: ${allocs.docs.filter((d) => !d.data().consumed_at).length}`);

for (const li of order.line_items ?? []) {
  console.log(`\n--- Line ${li.title} qty=${li.qty} variant=${li.variant_id} ---`);
  const batches = await db
    .collection("batches")
    .where("variant_id", "==", li.variant_id)
    .get();
  let shippable = 0;
  let activeAssignable = 0;
  for (const d of batches.docs) {
    const b = d.data();
    const exp = b.expiry_date?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? "?";
    const assignable = isBatchAssignable(b.expiry_date, minDays);
    const rem = b.remaining_qty ?? 0;
    if (assignable && rem > 0) {
      shippable += rem;
      if (b.status === "ACTIVE") activeAssignable += rem;
    }
    console.log(
      `  ${b.charge_number} status=${b.status} rem=${rem} MHD=${exp} assignable=${assignable}`,
    );
  }
  const openAllocs = await db
    .collection("allocations")
    .where("variant_id", "==", li.variant_id)
    .get();
  let allocOnShippable = 0;
  for (const d of openAllocs.docs) {
    const a = d.data();
    if (a.consumed_at || a.released) continue;
    const batch = batches.docs.find((x) => x.id === a.batch_id)?.data();
    if (batch && isBatchAssignable(batch.expiry_date, minDays)) {
      allocOnShippable += a.qty;
    }
  }
  console.log(`shippable remaining: ${shippable}`);
  console.log(`ACTIVE pool (assign-batches): ${activeAssignable}`);
  console.log(`open alloc on shippable batches: ${allocOnShippable}`);
  console.log(`total shippable units: ${shippable + allocOnShippable}`);
  console.log(`need: ${li.qty} → ${activeAssignable >= li.qty ? "✅ assign OK" : "❌ assign FAIL"}`);
}
