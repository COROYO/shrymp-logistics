import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@/server/firestore/schema";

const VERSION = "v1";
export const LOCAL_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export type LocalSession = {
  uid: string;
  email: string | null;
  role: UserRole | null;
};

function secret(): string {
  const value = process.env.SESSION_SECRET || process.env.CRON_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET or CRON_SECRET is required");
  }
  return value;
}

function signPayload(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signLocalSession(session: LocalSession, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid: session.uid,
      email: session.email,
      role: session.role,
      exp: now + LOCAL_SESSION_MAX_AGE_MS,
    }),
  ).toString("base64url");
  return `${VERSION}.${payload}.${signPayload(payload)}`;
}

export function readLocalSession(token: string, now = Date.now()): LocalSession | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const payload = parts[1]!;
  const sig = parts[2]!;
  const expected = signPayload(payload);
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      uid?: unknown;
      email?: unknown;
      role?: unknown;
      exp?: unknown;
    };
    if (typeof body.uid !== "string" || body.uid.length === 0) return null;
    if (typeof body.exp !== "number" || body.exp <= now) return null;
    const email = typeof body.email === "string" ? body.email : null;
    const role = body.role === "ADMIN" || body.role === "LAGER" ? body.role : null;
    return { uid: body.uid, email, role };
  } catch {
    return null;
  }
}
