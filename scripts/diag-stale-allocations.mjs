// Diagnose stale Charge assignments left over from the pre-refactor allocation
// model (which pinned batches at allocation time). In the new model batches are
// only pinned at slip print (run_id = "assign-on-slip"); a NEW/SHIP/STOP order
// must NOT carry an open allocation.
//
// READ-ONLY. Run: node --env-file=.env.local scripts/diag-stale-allocations.mjs
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

const ASSIGN_ON_SLIP = "assign-on-slip";

// --- Load all allocations, keep the open ones (not consumed, not released) ---
const allocSnap = await db.collection("allocations").get();
const open = allocSnap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((a) => !a.consumed_at && a.released !== true);

console.log(
  `Total allocations: ${allocSnap.size} | open (not consumed/released): ${open.length}`,
);

// --- Resolve each open allocation's order status ---
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

// --- Group: status × source (legacy run vs assign-on-slip) ---
const grid = new Map(); // status -> { slip, legacy }
for (const a of open) {
  const status = statusByOrder.get(a.order_id) ?? "MISSING";
  const bucket = grid.get(status) ?? { slip: 0, legacy: 0 };
  if (a.run_id === ASSIGN_ON_SLIP) bucket.slip++;
  else bucket.legacy++;
  grid.set(status, bucket);
}

console.log("\n=== Open allocations by order status × source ===");
console.log("status".padEnd(12), "assign-on-slip".padStart(16), "legacy".padStart(10));
for (const [status, b] of grid) {
  console.log(status.padEnd(12), String(b.slip).padStart(16), String(b.legacy).padStart(10));
}

// --- Candidates the cleanup would remove: legacy rows on NEW/SHIP/STOP ---
const CLEANABLE = new Set(["NEW", "SHIP", "STOP", "MISSING"]);
const candidates = open.filter(
  (a) =>
    a.run_id !== ASSIGN_ON_SLIP &&
    CLEANABLE.has(statusByOrder.get(a.order_id) ?? "MISSING"),
);
console.log(`\n=== Cleanup candidates (legacy + NEW/SHIP/STOP/MISSING): ${candidates.length} ===`);
for (const a of candidates.slice(0, 25)) {
  console.log(
    `  order=${a.order_id} status=${statusByOrder.get(a.order_id)} batch=${a.batch_id} qty=${a.qty} run_id=${a.run_id}`,
  );
}
if (candidates.length > 25) console.log(`  … and ${candidates.length - 25} more`);

// --- Warn about anything we DON'T clean but looks odd ---
const legacyPicking = open.filter(
  (a) => a.run_id !== ASSIGN_ON_SLIP && statusByOrder.get(a.order_id) === "PICKING",
);
if (legacyPicking.length > 0) {
  console.log(
    `\n⚠️  ${legacyPicking.length} legacy open allocations on PICKING orders — NOT auto-cleaned (they may be needed to pack). Review manually:`,
  );
  for (const a of legacyPicking.slice(0, 15)) {
    console.log(`  order=${a.order_id} batch=${a.batch_id} qty=${a.qty} run_id=${a.run_id}`);
  }
}

process.exit(0);
