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
 *   2. App Hosting / GCP runtime — `FIREBASE_CONFIG` + ADC (`initializeApp()`
 *      with no args; see Firebase App Hosting docs).
 *   3. Application Default Credentials with an explicit project id
 *      (`FIREBASE_PROJECT_ID`, `GCP_PROJECT_ID`, or
 *      `NEXT_PUBLIC_FIREBASE_PROJECT_ID`).
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

export function resolveFirebaseProjectId(): string | undefined {
  const explicit =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.GCP_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (explicit) return explicit;

  const raw = process.env.FIREBASE_CONFIG;
  if (!raw) return undefined;
  try {
    const cfg = JSON.parse(raw) as { projectId?: string };
    return cfg.projectId;
  } catch {
    return undefined;
  }
}

function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }

  const projectId = resolveFirebaseProjectId();
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson && saJson.trim().length > 0) {
    if (!projectId) {
      throw new Error(
        "FIREBASE_PROJECT_ID env var is required when using FIREBASE_SERVICE_ACCOUNT_JSON. Add it to .env.local.",
      );
    }
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
  } else if (process.env.FIREBASE_CONFIG) {
    // App Hosting injects FIREBASE_CONFIG at build + runtime; ADC supplies auth.
    cachedApp = initializeApp();
  } else if (projectId) {
    // ADC (Application Default Credentials) — works on Firebase / GCP runtime
    // or after `gcloud auth application-default login` locally.
    cachedApp = initializeApp({ projectId });
  } else {
    throw new Error(
      "FIREBASE_PROJECT_ID env var is required. Add it to .env.local.",
    );
  }

  return cachedApp;
}

export function adminDb(): Firestore {
  const db = getFirestore(getAdminApp());
  // `db.settings()` can only be called once per Firestore instance, BEFORE
  // any other method on it. In serverless runtimes (Vercel / Firebase
  // Functions) the SDK's `getFirestore()` returns the same cached instance
  // across our module reloads — so a module-scoped "already applied" flag
  // is unreliable. The SDK doesn't expose a way to query current settings,
  // so the cleanest approach is to attempt the call and swallow the
  // "already initialized" error.
  //
  // Setting `ignoreUndefinedProperties: true` makes writes drop undefined
  // fields instead of throwing — matches our schema convention where
  // optional fields are simply omitted from documents.
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("already been initialized")) {
      // Different error — surface it. We don't want to swallow real
      // configuration bugs.
      throw e;
    }
    // Settings already applied on a previous request in this runtime —
    // safe to continue.
  }
  return db;
}

export function adminAuth(): Auth {
  return getAuth(getAdminApp());
}
