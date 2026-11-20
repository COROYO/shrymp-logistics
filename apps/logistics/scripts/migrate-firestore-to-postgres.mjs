// One-shot copy of top-level Firestore collections into Postgres `documents`.
// Run on a machine that can read Firestore, through a localhost tunnel.
// Subcollections are not visited. Do not log document bodies: they hold tokens.
//
// DATABASE_URL=postgres://lager:PASSWORD@127.0.0.1:54329/lager \
// FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccount.json \
// GOOGLE_CLOUD_PROJECT=shrymp-logistics \
// node apps/logistics/scripts/migrate-firestore-to-postgres.mjs
//
// The final `postgres <collection> <count>` lines must match the Firestore counts above.

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, Timestamp } from "firebase-admin/firestore";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const credsPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const credsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!getApps().length) {
  const credential = credsJson
    ? cert(JSON.parse(credsJson))
    : cert(credsPath ?? "./serviceAccount.json");
  initializeApp({ credential, projectId: process.env.GOOGLE_CLOUD_PROJECT });
}

function toJson(value) {
  if (value == null) return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && typeof value.toDate === "function" && "_seconds" in value) {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = toJson(entry);
    return out;
  }
  return value;
}

const db = getFirestore();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });

await pool.query(`
  CREATE TABLE IF NOT EXISTS documents (
    collection text NOT NULL,
    id text NOT NULL,
    data jsonb NOT NULL,
    PRIMARY KEY (collection, id)
  );
`);

await pool.query(`
  CREATE INDEX IF NOT EXISTS documents_collection_shop_id
  ON documents (collection, (data->>'shop_id'));
`);

const collections = await db.listCollections();
let total = 0;

for (const collection of collections) {
  let last = null;
  let count = 0;
  for (;;) {
    let query = collection.orderBy(FieldPath.documentId()).limit(200);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;

    const ids = [];
    const payloads = [];
    for (const doc of snap.docs) {
      ids.push(doc.id);
      payloads.push(JSON.stringify(toJson(doc.data())));
    }
    await pool.query(
      `INSERT INTO documents (collection, id, data)
       SELECT $1, id, data::jsonb
       FROM UNNEST($2::text[], $3::text[]) AS row(id, data)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
      [collection.id, ids, payloads],
    );
    count += snap.size;
    total += snap.size;
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 200) break;
  }
  console.log(`${collection.id} ${count}`);
}

const stored = await pool.query(
  `SELECT collection, count(*)::int AS n
   FROM documents
   GROUP BY collection
   ORDER BY collection`,
);
for (const row of stored.rows) {
  console.log(`postgres ${row.collection} ${row.n}`);
}

console.log(`imported ${total}`);
await pool.end();
