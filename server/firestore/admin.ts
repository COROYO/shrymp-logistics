import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

/**
 * Firebase Admin SDK initialization.
 *
 * Credentials are loaded from (in order of precedence):
 *   1. `FIREBASE_SERVICE_ACCOUNT_JSON` — full inlined JSON of the service
 *      account key file.
 *   2. Application Default Credentials (gcloud / Firebase / GCP runtime).
 *
 * `FIREBASE_PROJECT_ID` must always be set.
 */

let cachedApp: App | undefined;

function parseServiceAccount(raw: string): Record<string, unknown> {
  let s = raw.trim();
  // Common copy/paste artifacts: enclosing single or double quotes.
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    s = s.slice(1, -1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }. Make sure the value is on a single line (with \\n preserved in the private_key).`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  for (const required of ["project_id", "private_key", "client_email"]) {
    if (typeof obj[required] !== "string") {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_JSON is missing or has wrong type for field: ${required}`,
      );
    }
  }
  // dotenv sometimes turns the literal "\n" in the file into a backslash + n
  // pair when wrapped in single quotes; restore actual newlines.
  if (
    typeof obj.private_key === "string" &&
    !obj.private_key.includes("\n") &&
    obj.private_key.includes("\\n")
  ) {
    obj.private_key = obj.private_key.replaceAll("\\n", "\n");
  }
  return obj;
}

function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "FIREBASE_PROJECT_ID env var is required. Add it to .env.local.",
    );
  }

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson && saJson.trim().length > 0) {
    const parsed = parseServiceAccount(saJson);
    // Sanity: project_id in the key should match the env, otherwise the
    // user has the wrong key for the wrong project — fail loudly.
    if (parsed["project_id"] && parsed["project_id"] !== projectId) {
      throw new Error(
        `Service account key is for project "${parsed["project_id"]}" but FIREBASE_PROJECT_ID is "${projectId}". They must match.`,
      );
    }
    cachedApp = initializeApp({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      credential: cert(parsed as any),
      projectId,
    });
  } else {
    // ADC (Application Default Credentials) — works on Firebase / GCP runtime
    // or after `gcloud auth application-default login` locally.
    cachedApp = initializeApp({ projectId });
  }

  return cachedApp;
}

let dbSettingsApplied = false;

export function adminDb(): Firestore {
  const db = getFirestore(getAdminApp());
  if (!dbSettingsApplied) {
    // Treat any field set to `undefined` as "drop on write" rather than
    // throwing — matches our schema convention where optional fields are
    // simply omitted from documents.
    db.settings({ ignoreUndefinedProperties: true });
    dbSettingsApplied = true;
  }
  return db;
}

export function adminAuth(): Auth {
  return getAuth(getAdminApp());
}
