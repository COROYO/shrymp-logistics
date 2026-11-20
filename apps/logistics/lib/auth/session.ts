import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { readLocalSession } from "@/lib/auth/local-session";
import { adminAuth } from "@/server/firestore/admin";
import type { UserRole } from "@/server/firestore/schema";

/**
 * Session helpers built on a Firebase Auth ID-token cookie.
 *
 * Flow:
 * 1. Client signs in with `signInWithEmailAndPassword`, receives an ID token.
 * 2. Client POSTs the ID token to `/api/auth/session`. The server checks
 *    the token signature against Google's public keys and sets a signed
 *    `__session` cookie. No Firebase service-account key is required.
 * 3. Server code (layouts, server actions, route handlers) calls
 *    `getSessionUser()` to read + verify the cookie.
 */

export const SESSION_COOKIE = "__session";

export type SessionUser = {
  uid: string;
  email: string | null;
  role: UserRole | null;
};

async function getSessionUserUncached(): Promise<SessionUser | null> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  try {
    const local = readLocalSession(cookie);
    if (local) return local;
    // Older Firebase session cookies, when a service account is configured.
    const decoded = await adminAuth().verifySessionCookie(cookie, false);
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

/** Deduped within a single RSC request (layout + page share one verify). */
export const getSessionUser = cache(getSessionUserUncached);

export async function requireRole(
  ...allowed: UserRole[]
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (user.role && allowed.includes(user.role)) return user;
  throw new Error("FORBIDDEN");
}
