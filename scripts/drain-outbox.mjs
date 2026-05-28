// Reset and drain all pending Shopify outbox entries.
// Use after fixing a bug that prevented dispatch (e.g. fire-and-forget
// processOutbox that never ran).
//
// Run: node --env-file=.env.local scripts/drain-outbox.mjs
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();

const snap = await db
  .collection("shopify_outbox")
  .orderBy("created_at", "desc")
  .limit(500)
  .get();

let pending = 0;
const byOp = {};
const batch = db.batch();
const now = admin.firestore.Timestamp.now();
for (const d of snap.docs) {
  const data = d.data();
  if (data.done_at) continue;
  pending++;
  byOp[data.op] = (byOp[data.op] ?? 0) + 1;
  // Reset attempts + next_retry so processOutbox picks it up immediately.
  batch.update(d.ref, {
    attempts: 0,
    next_retry_at: now,
    last_error: admin.firestore.FieldValue.delete(),
  });
}
console.log(`Pending outbox rows: ${pending}`);
for (const [op, n] of Object.entries(byOp)) {
  console.log(`  ${op.padEnd(20)}  ${n}`);
}
if (pending > 0) {
  await batch.commit();
  console.log("\n✅ Reset. Next processOutbox() call drains them.");
  console.log(
    "Trigger by: clicking 'Bestände nach Shopify pushen' on /admin/settings,",
  );
  console.log(
    "or 'Allocation jetzt laufen lassen' (which now awaits processOutbox).",
  );
} else {
  console.log("Nothing to do.");
}
