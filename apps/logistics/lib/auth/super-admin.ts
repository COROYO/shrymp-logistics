import "server-only";
import type { SessionUser } from "./session";

function parseSuperAdminEmails(): Set<string> {
  const raw = process.env.SUPER_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Internal ops accounts that may access every active tenant. */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email?.trim()) return false;
  return parseSuperAdminEmails().has(email.trim().toLowerCase());
}

export function isSuperAdmin(user: SessionUser): boolean {
  return user.role === "ADMIN" && isSuperAdminEmail(user.email);
}
