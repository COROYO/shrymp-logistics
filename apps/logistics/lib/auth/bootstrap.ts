import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/server/firestore/admin";
import { Collections, type UserRole } from "@/server/firestore/schema";
import { log } from "@/lib/logger";

/**
 * Returns true if at least one ADMIN-role user exists in the system.
 * Used to gate the public bootstrap-first-admin flow.
 */
export async function hasAnyAdmin(): Promise<boolean> {
  try {
    const snap = await adminDb()
      .collection(Collections.Users)
      .where("role", "==", "ADMIN")
      .limit(1)
      .get();
    return !snap.empty;
  } catch (e) {
    // Log the underlying cause so it shows up in `pnpm dev` terminal output,
    // then re-throw so callers can render a config-error page.
    log.error("hasAnyAdmin_failed", {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    throw e;
  }
}

/**
 * Create the first admin account. Refuses if an ADMIN already exists.
 * Sets Firebase Auth custom claim `role: ADMIN` and writes the Firestore
 * users/{uid} mirror doc.
 *
 * Idempotency: caller is expected to have already checked `hasAnyAdmin()`
 * but we re-check inside as a guard against race conditions.
 */
export async function createFirstAdmin(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ uid: string }> {
  if (await hasAnyAdmin()) {
    throw new Error("admin_already_exists");
  }
  return createUserWithRole({ ...input, role: "ADMIN" });
}

/**
 * Used by both `createFirstAdmin` and (later) the in-app user invitation flow.
 */
export async function createUserWithRole(input: {
  email: string;
  password: string;
  role: UserRole;
  displayName?: string;
}): Promise<{ uid: string }> {
  const auth = adminAuth();
  const db = adminDb();

  const created = await auth.createUser({
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    emailVerified: false,
    disabled: false,
  });
  await auth.setCustomUserClaims(created.uid, { role: input.role });

  await db.collection(Collections.Users).doc(created.uid).set({
    id: created.uid,
    email: input.email,
    display_name: input.displayName ?? null,
    role: input.role,
    created_at: FieldValue.serverTimestamp(),
    disabled: false,
  });

  log.info("user_created", { uid: created.uid, role: input.role });
  return { uid: created.uid };
}
