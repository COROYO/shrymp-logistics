// Delete stale Charge assignments left over from the pre-refactor allocation
// model. In the new model batches are only pinned at slip print
// (run_id = "assign-on-slip"); a NEW/SHIP/STOP order must NOT carry an open
// allocation. Legacy rows never decremented batch.remaining_qty, so deleting
// them needs NO stock restore. reserved_total is status-derived now, so it's
// unaffected too.
//
// SAFETY:
//   - Only deletes OPEN (not consumed, not released) allocations.
//   - Only LEGACY rows (run_id != "assign-on-slip") — never touches new
//     assignments (e.g. a printed-then-cancelled-picking SHIP order).
//   - Only on orders in NEW / SHIP / STOP / MISSING — never PICKING or PACKED.
//
// Dry-run by default. Run:
//   node --env-file=.env.local scripts/cleanup-stale-allocations.mjs           # dry-run
//   node --env-file=.env.local scripts/cleanup-stale-allocations.mjs --apply   # delete
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
const ASSIGN_ON_SLIP = "assign-on-slip";
const CLEANABLE = new Set(["NEW", "SHIP", "STOP", "MISSING"]);

const allocSnap = await db.collection("allocations").get();
const open = allocSnap.docs
  .map((d) => ({ ref: d.ref, id: d.id, ...d.data() }))
  .filter((a) => !a.consumed_at && a.released !== true);

const orderIds = Array.from(new Set(open.map((a) => a.order_id)));
const statusByOrder = new Map();
for (let i = 0; i < orderIds.length; i += 300) {
  const refs = orderIds
    .slice(i, i + 300)
    .map((id) => db.collection("orders").doc(id));
  const snaps = await db.getAll(...refs);
  for (const s of snaps) {
    statusByOrder.set(s.id, s.exists ? s.data().internal_status : "MISSING");
  }
}

const toDelete = open.filter(
  (a) =>
    a.run_id !== ASSIGN_ON_SLIP &&
    CLEANABLE.has(statusByOrder.get(a.order_id) ?? "MISSING"),
);

console.log(
  `${APPLY ? "APPLY" : "DRY-RUN"} | open=${open.length} | to delete=${toDelete.length}`,
);
for (const a of toDelete.slice(0, 20)) {
  console.log(
    `  order=${a.order_id} status=${statusByOrder.get(a.order_id)} batch=${a.batch_id} qty=${a.qty} run_id=${a.run_id}`,
  );
}
if (toDelete.length > 20) console.log(`  … and ${toDelete.length - 20} more`);

if (!APPLY) {
  console.log("\nDry-run only. Re-run with --apply to delete.");
  process.exit(0);
}

let deleted = 0;
let batch = db.batch();
let ops = 0;
for (const a of toDelete) {
  batch.delete(a.ref);
  ops++;
  deleted++;
  if (ops >= 450) {
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }
}
if (ops > 0) await batch.commit();

console.log(`\n✅ Deleted ${deleted} stale allocations.`);
process.exit(0);
