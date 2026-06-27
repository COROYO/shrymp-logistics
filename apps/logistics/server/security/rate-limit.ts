import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";

/**
 * Minimal fixed-window rate limiter backed by Firestore.
 *
 * Used to throttle unauthenticated, abusable endpoints (e.g. public
 * registration) so a single client can't create unbounded accounts. Not a
 * substitute for a CDN/WAF, but enough to stop trivial scripted abuse.
 *
 * One transaction per call. Window buckets are stored under `rate_limits/`.
 */
const COLLECTION = "rate_limits";

export type RateLimitResult = { allowed: boolean; remaining: number };

export async function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const { limit, windowMs } = opts;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const safeKey = key.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 200);
  const ref = adminDb()
    .collection(COLLECTION)
    .doc(`${safeKey}:${windowStart}`);

  try {
    return await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = (snap.data()?.count as number | undefined) ?? 0;
      if (count >= limit) {
        return { allowed: false, remaining: 0 };
      }
      tx.set(
        ref,
        {
          count: FieldValue.increment(1),
          window_start: windowStart,
          expires_at: windowStart + windowMs,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { allowed: true, remaining: limit - count - 1 };
    });
  } catch {
    // Fail open on infrastructure errors — availability over strictness.
    return { allowed: true, remaining: limit };
  }
}

/** Best-effort client IP from proxy headers (App Hosting / Cloud Run). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
