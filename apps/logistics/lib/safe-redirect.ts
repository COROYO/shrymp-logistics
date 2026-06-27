/**
 * Sanitize a user-supplied `next` redirect target to an internal path only.
 * Prevents open-redirect via `?next=https://evil.com` or `//evil.com`.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/",
): string {
  if (!next) return fallback;
  // Must be a same-origin absolute path, not a protocol-relative or absolute URL.
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
