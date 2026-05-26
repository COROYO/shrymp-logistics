import "server-only";
import { cookies } from "next/headers";
import { adminAuth } from "@/server/firestore/admin";
import type { UserRole } from "@/server/firestore/schema";

/**
 * Session helpers built on a Firebase Auth ID-token cookie.
 *
 * Flow:
 * 1. Client signs in with `signInWithEmailAndPassword`, receives an ID token.
 * 2. Client POSTs the ID token to `/api/auth/session` which sets a
 *    server-side `__session` cookie containing a Firebase session cookie
 *    (long-lived, revocable).
 * 3. Server code (layouts, server actions, route handlers) calls
 *    `getSessionUser()` to read + verify the cookie.
 */

export const SESSION_COOKIE = "__session";

export type SessionUser = {
  uid: string;
  email: string | null;
  role: UserRole | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    const role = (decoded.role ?? null) as UserRole | null;
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      role,
    };
  } catch {
    return null;
  }
}

export async function requireRole(
  ...allowed: UserRole[]
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (user.role && allowed.includes(user.role)) return user;
  throw new Error("FORBIDDEN");
}
