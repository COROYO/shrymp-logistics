"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  createUser,
  deleteUser,
  resetUserPassword,
  setUserDisabled,
  setUserRole,
  UserMgmtError,
} from "@/server/users/management";
import {
  assertUserInAccessibleShops,
  TenantAccessError,
} from "@/lib/auth/tenant-guard";
import { log } from "@/lib/logger";

function tenantErrorResult(e: unknown): { ok: false; error: string } | null {
  if (e instanceof TenantAccessError) {
    return { ok: false, error: e.code === "NOT_FOUND" ? "not_found" : "forbidden" };
  }
  return null;
}

// ----------------------- create -----------------------

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().max(80).optional().or(z.literal("")),
  role: z.enum(["ADMIN", "LAGER"]),
});

export type CreateUserActionState =
  | { ok: true; uid: string }
  | { ok: false; error: string }
  | null;

export async function createUserAction(
  _prev: CreateUserActionState,
  formData: FormData,
): Promise<CreateUserActionState> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = CreateUserSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName") ?? undefined,
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  try {
    const actor = await requireRole("ADMIN");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(actor);
    const r = await createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      displayName: parsed.data.displayName || undefined,
      role: parsed.data.role,
      shop_ids: [shopId],
    });
    revalidatePath("/admin/users");
    return { ok: true, uid: r.uid };
  } catch (e) {
    log.warn("create_user_failed", { error: String(e) });
    if (e instanceof UserMgmtError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ----------------------- update role -----------------------

export async function setUserRoleAction(
  uid: string,
  role: "ADMIN" | "LAGER",
): Promise<{ ok: true } | { ok: false; error: string }> {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    await assertUserInAccessibleShops(uid, actor);
    await setUserRole(uid, role, actor.uid);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) {
    const te = tenantErrorResult(e);
    if (te) return te;
    if (e instanceof UserMgmtError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ----------------------- disable / enable -----------------------

export async function setUserDisabledAction(
  uid: string,
  disabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    await assertUserInAccessibleShops(uid, actor);
    await setUserDisabled(uid, disabled, actor.uid);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) {
    const te = tenantErrorResult(e);
    if (te) return te;
    if (e instanceof UserMgmtError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ----------------------- reset password -----------------------

export async function resetUserPasswordAction(
  uid: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Passwort min. 8 Zeichen" };
  }
  try {
    await assertUserInAccessibleShops(uid, actor);
    await resetUserPassword(uid, newPassword);
    return { ok: true };
  } catch (e) {
    const te = tenantErrorResult(e);
    if (te) return te;
    if (e instanceof UserMgmtError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ----------------------- delete -----------------------

export async function deleteUserAction(
  uid: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    await assertUserInAccessibleShops(uid, actor);
    await deleteUser(uid, actor.uid);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) {
    const te = tenantErrorResult(e);
    if (te) return te;
    if (e instanceof UserMgmtError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
