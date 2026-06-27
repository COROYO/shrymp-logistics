import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { UserRecord } from "firebase-admin/auth";
import { adminAuth, adminDb } from "@/server/firestore/admin";
import { Collections, type UserRole } from "@/server/firestore/schema";
import { log } from "@/lib/logger";

export class UserMgmtError extends Error {
  constructor(
    public readonly code:
      | "self_action_forbidden"
      | "user_not_found"
      | "email_already_exists"
      | "weak_password"
      | "invalid_email"
      | "would_lose_last_admin",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "UserMgmtError";
  }
}

export type UserListEntry = {
  uid: string;
  email: string | null;
  display_name: string | null;
  role: UserRole | null;
  disabled: boolean;
  shop_ids: string[];
  /** Last sign-in / creation timestamps as ISO. */
  created_at_iso: string | null;
  last_sign_in_iso: string | null;
  /** True if a Firestore mirror doc exists. */
  has_mirror: boolean;
};

export async function listUsersForShops(
  shopIds: string[],
  includeUid?: string,
): Promise<UserListEntry[]> {
  const normalized = shopIds.map((s) => s.trim().toLowerCase());
  if (normalized.length === 0 && !includeUid) return [];

  const db = adminDb();
  const auth = adminAuth();

  // Query only the mirror docs scoped to these shops (chunks of 30 for the
  // Firestore array-contains-any limit) — no global user scan.
  const uids = new Set<string>();
  for (let i = 0; i < normalized.length; i += 30) {
    const chunk = normalized.slice(i, i + 30);
    if (chunk.length === 0) continue;
    const snap = await db
      .collection(Collections.Users)
      .where("shop_ids", "array-contains-any", chunk)
      .get();
    for (const d of snap.docs) uids.add(d.id);
  }
  if (includeUid) uids.add(includeUid);
  if (uids.size === 0) return [];

  const uidList = [...uids];
  const mirrorByUid = new Map<
    string,
    {
      role: UserRole | null;
      display_name: string | null;
      disabled: boolean;
      shop_ids: string[];
    }
  >();
  // Fetch mirror docs + auth records in batches of 100 (getUsers limit).
  const entries: UserListEntry[] = [];
  for (let i = 0; i < uidList.length; i += 100) {
    const chunk = uidList.slice(i, i + 100);
    const [mirrorSnaps, authResult] = await Promise.all([
      db.getAll(
        ...chunk.map((uid) => db.collection(Collections.Users).doc(uid)),
      ),
      auth.getUsers(chunk.map((uid) => ({ uid }))),
    ]);
    for (const d of mirrorSnaps) {
      if (!d.exists) continue;
      const data = d.data() ?? {};
      const rawIds = data.shop_ids;
      mirrorByUid.set(d.id, {
        role: (data.role as UserRole | undefined) ?? null,
        display_name: (data.display_name as string | undefined) ?? null,
        disabled: !!data.disabled,
        shop_ids: Array.isArray(rawIds)
          ? rawIds.map((s) => String(s).trim().toLowerCase())
          : [],
      });
    }
    for (const u of authResult.users) {
      entries.push(userRecordToEntry(u, mirrorByUid));
    }
  }

  return entries.sort((a, b) => {
    if ((a.role === "ADMIN") !== (b.role === "ADMIN")) {
      return a.role === "ADMIN" ? -1 : 1;
    }
    const da = a.created_at_iso ?? "";
    const dbb = b.created_at_iso ?? "";
    if (da !== dbb) return dbb.localeCompare(da);
    return (a.email ?? "").localeCompare(b.email ?? "");
  });
}

export async function listUsers(): Promise<UserListEntry[]> {
  const auth = adminAuth();
  const db = adminDb();

  // Up to 1000 in one shot is fine for an internal team. Page if needed.
  const list = await auth.listUsers(1000);
  const mirrorSnap = await db.collection(Collections.Users).get();
  const mirrorByUid = new Map<
    string,
    {
      role: UserRole | null;
      display_name: string | null;
      disabled: boolean;
      shop_ids: string[];
    }
  >();
  for (const d of mirrorSnap.docs) {
    const data = d.data() ?? {};
    const rawIds = data.shop_ids;
    mirrorByUid.set(d.id, {
      role: (data.role as UserRole | undefined) ?? null,
      display_name: (data.display_name as string | undefined) ?? null,
      disabled: !!data.disabled,
      shop_ids: Array.isArray(rawIds)
        ? rawIds.map((s) => String(s).trim().toLowerCase())
        : [],
    });
  }

  return list.users
    .map((u) => userRecordToEntry(u, mirrorByUid))
    .sort((a, b) => {
      // Admins first, then by created_at desc, then by email
      if ((a.role === "ADMIN") !== (b.role === "ADMIN")) {
        return a.role === "ADMIN" ? -1 : 1;
      }
      const da = a.created_at_iso ?? "";
      const dbb = b.created_at_iso ?? "";
      if (da !== dbb) return dbb.localeCompare(da);
      return (a.email ?? "").localeCompare(b.email ?? "");
    });
}

function userRecordToEntry(
  u: UserRecord,
  mirror: Map<
    string,
    {
      role: UserRole | null;
      display_name: string | null;
      disabled: boolean;
      shop_ids: string[];
    }
  >,
): UserListEntry {
  const m = mirror.get(u.uid);
  const claimRole = (u.customClaims?.["role"] as UserRole | undefined) ?? null;
  return {
    uid: u.uid,
    email: u.email ?? null,
    display_name: m?.display_name ?? u.displayName ?? null,
    role: claimRole ?? m?.role ?? null,
    disabled: u.disabled,
    shop_ids: m?.shop_ids ?? [],
    created_at_iso: u.metadata.creationTime
      ? new Date(u.metadata.creationTime).toISOString()
      : null,
    last_sign_in_iso: u.metadata.lastSignInTime
      ? new Date(u.metadata.lastSignInTime).toISOString()
      : null,
    has_mirror: !!m,
  };
}

// ----------------------- create -----------------------

export async function createUser(input: {
  email: string;
  password: string;
  displayName?: string;
  role: UserRole;
  shop_ids?: string[];
}): Promise<{ uid: string }> {
  if (!input.email) throw new UserMgmtError("invalid_email");
  if (!input.password || input.password.length < 8) {
    throw new UserMgmtError("weak_password", "Passwort min. 8 Zeichen");
  }
  const auth = adminAuth();
  const db = adminDb();

  let created: UserRecord;
  try {
    created = await auth.createUser({
      email: input.email.trim(),
      password: input.password,
      displayName: input.displayName?.trim(),
      emailVerified: false,
      disabled: false,
    });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/email-already-exists") {
      throw new UserMgmtError("email_already_exists");
    }
    if (code === "auth/invalid-email") {
      throw new UserMgmtError("invalid_email");
    }
    if (code === "auth/invalid-password") {
      throw new UserMgmtError("weak_password");
    }
    throw e;
  }

  await auth.setCustomUserClaims(created.uid, { role: input.role });

  await db.collection(Collections.Users).doc(created.uid).set({
    id: created.uid,
    email: input.email.trim(),
    display_name: input.displayName?.trim() ?? null,
    role: input.role,
    ...(input.shop_ids?.length ? { shop_ids: input.shop_ids } : {}),
    created_at: FieldValue.serverTimestamp(),
    disabled: false,
  });

  log.info("user_created", { uid: created.uid, role: input.role });
  return { uid: created.uid };
}

// ----------------------- update role -----------------------

export async function setUserRole(
  uid: string,
  role: UserRole,
  actingUid: string,
): Promise<void> {
  if (uid === actingUid && role !== "ADMIN") {
    throw new UserMgmtError(
      "self_action_forbidden",
      "Du kannst deine eigene Admin-Rolle nicht entziehen.",
    );
  }
  const auth = adminAuth();
  const db = adminDb();

  // Guard against removing the last admin.
  if (role !== "ADMIN") {
    await assertNotLastAdmin(uid);
  }

  let current: UserRecord;
  try {
    current = await auth.getUser(uid);
  } catch {
    throw new UserMgmtError("user_not_found");
  }
  const claims = { ...(current.customClaims ?? {}), role };
  await auth.setCustomUserClaims(uid, claims);

  await db
    .collection(Collections.Users)
    .doc(uid)
    .set(
      {
        id: uid,
        email: current.email ?? null,
        role,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  log.info("user_role_updated", { uid, role });
}

// ----------------------- disable / enable -----------------------

export async function setUserDisabled(
  uid: string,
  disabled: boolean,
  actingUid: string,
): Promise<void> {
  if (uid === actingUid && disabled) {
    throw new UserMgmtError(
      "self_action_forbidden",
      "Du kannst dich nicht selbst deaktivieren.",
    );
  }
  if (disabled) {
    // If we're disabling, check it's not the last admin.
    await assertNotLastAdmin(uid);
  }
  const auth = adminAuth();
  const db = adminDb();
  try {
    await auth.updateUser(uid, { disabled });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/user-not-found") throw new UserMgmtError("user_not_found");
    throw e;
  }
  await db
    .collection(Collections.Users)
    .doc(uid)
    .set(
      { disabled, updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    );
  log.info("user_disabled_changed", { uid, disabled });
}

// ----------------------- reset password -----------------------

export async function resetUserPassword(
  uid: string,
  newPassword: string,
): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new UserMgmtError("weak_password", "Passwort min. 8 Zeichen");
  }
  const auth = adminAuth();
  try {
    await auth.updateUser(uid, { password: newPassword });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/user-not-found") throw new UserMgmtError("user_not_found");
    if (code === "auth/invalid-password") throw new UserMgmtError("weak_password");
    throw e;
  }
  log.info("user_password_reset", { uid });
}

// ----------------------- delete -----------------------

export async function deleteUser(
  uid: string,
  actingUid: string,
): Promise<void> {
  if (uid === actingUid) {
    throw new UserMgmtError(
      "self_action_forbidden",
      "Du kannst dich nicht selbst löschen.",
    );
  }
  await assertNotLastAdmin(uid);
  const auth = adminAuth();
  const db = adminDb();
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/user-not-found") throw new UserMgmtError("user_not_found");
    throw e;
  }
  await db
    .collection(Collections.Users)
    .doc(uid)
    .delete()
    .catch(() => {});
  log.info("user_deleted", { uid });
}

// ----------------------- helpers -----------------------

async function assertNotLastAdmin(uid: string): Promise<void> {
  // Count active admins. If the only one is this uid, abort.
  const auth = adminAuth();
  const list = await auth.listUsers(1000);
  const activeAdmins = list.users.filter(
    (u) =>
      !u.disabled &&
      (u.customClaims?.["role"] as string | undefined) === "ADMIN",
  );
  if (
    activeAdmins.length === 1 &&
    activeAdmins[0] &&
    activeAdmins[0].uid === uid
  ) {
    throw new UserMgmtError(
      "would_lose_last_admin",
      "Letzter aktiver Admin — Aktion abgelehnt.",
    );
  }
}
