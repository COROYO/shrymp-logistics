import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/server/firestore/admin";
import {
  LOCAL_SESSION_MAX_AGE_MS,
  signLocalSession,
} from "@/lib/auth/local-session";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { log } from "@/lib/logger";
import { Collections, type UserRole } from "@/server/firestore/schema";

const Body = z.object({ idToken: z.string().min(10) });

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    // Public-key check only. Creating a Firebase session cookie needs a
    // service account key, which this project is not allowed to mint.
    const decoded = await adminAuth().verifyIdToken(parsed.idToken, false);
    const claim = decoded.role;
    let role: UserRole | null = claim === "ADMIN" || claim === "LAGER" ? claim : null;
    if (!role) {
      const snap = await adminDb().collection(Collections.Users).doc(decoded.uid).get();
      const stored = snap.data()?.role;
      role = stored === "ADMIN" || stored === "LAGER" ? stored : null;
    }
    const sessionCookie = signLocalSession({
      uid: decoded.uid,
      email: decoded.email ?? null,
      role,
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: LOCAL_SESSION_MAX_AGE_MS / 1000,
      path: "/",
    });
    return res;
  } catch (e) {
    log.warn("session_create_failed", { error: String(e) });
    return NextResponse.json({ error: "auth_failed" }, { status: 401 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
