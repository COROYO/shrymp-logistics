import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/server/firestore/admin";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { log } from "@/lib/logger";

const Body = z.object({ idToken: z.string().min(10) });

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const sessionCookie = await adminAuth().createSessionCookie(
      parsed.idToken,
      { expiresIn: SESSION_DURATION_MS },
    );

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_DURATION_MS / 1000,
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
