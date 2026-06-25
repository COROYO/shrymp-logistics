// Reset every undone INVENTORY_SET outbox entry so it gets picked up again
// on the next processOutbox() drain.
//
// Run: node --env-file=.env.local scripts/reset-stuck-outbox.mjs
import admin from "firebase-admin";

if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();
const now = admin.firestore.Timestamp.now();

const snap = await db
  .collection("shopify_outbox")
  .orderBy("created_at", "desc")
  .limit(200)
  .get();

let reset = 0;
const batch = db.batch();
for (const d of snap.docs) {
  const data = d.data();
  if (data.done_at) continue;
  if (data.op !== "INVENTORY_SET") continue;
  batch.update(d.ref, {
    attempts: 0,
    next_retry_at: now,
    last_error: admin.firestore.FieldValue.delete(),
  });
  reset++;
}
if (reset > 0) await batch.commit();
console.log(`Reset ${reset} outbox entries — ready for next drain.`);
