// Show webhook_events with status=FAILED — these are the ones our endpoint
// caught but couldn't process. The `error` field tells us why.
// Run: node --env-file=.env.local scripts/diag-failed-webhooks.mjs
import admin from "firebase-admin";
if (!admin.apps.length) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(json) });
}
const db = admin.firestore();
const snap = await db
  .collection("webhook_events")
  .where("status", "==", "FAILED")
  .orderBy("received_at", "desc")
  .limit(20)
  .get();
console.log(`Failed webhooks: ${snap.docs.length}\n`);
for (const d of snap.docs) {
  const data = d.data();
  const recv = data.received_at?.toDate?.()?.toISOString?.() ?? "?";
  console.log(`${recv}  ${data.topic}`);
  console.log(`  ${data.error?.slice(0, 300) ?? "?"}\n`);
}
