import { runtimeEnv } from "@/lib/runtime-env";

/**
 * Origin for browser redirects and the Shopify OAuth redirect_uri.
 *
 * `next start -H 0.0.0.0` (Cloud Run) makes `new URL(req.url).origin`
 * `https://0.0.0.0:8080`. Shopify would send the merchant there. The public
 * app URL is APP_BASE_URL (`https://lager.shrymp.de`).
 */
export function publicOrigin(req: Request): string {
  const configured = configuredOrigin();
  if (configured) return configured;

  const forwarded = originFromHost(
    firstHeader(req, "x-forwarded-host"),
    firstHeader(req, "x-forwarded-proto") ?? "https",
  );
  if (forwarded) return forwarded;

  const host = originFromHost(firstHeader(req, "host"), "https");
  if (host) return host;

  try {
    const origin = new URL(req.url).origin;
    if (!isBindAddress(new URL(origin).hostname)) return origin;
  } catch {
    // Relative or unparseable request URL — caller still needs an origin.
  }

  return "http://localhost:3000";
}

function configuredOrigin(): string | null {
  const raw = runtimeEnv("APP_BASE_URL")?.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

function originFromHost(
  host: string | null,
  proto: string,
): string | null {
  if (!host || isBindAddress(host)) return null;
  const scheme = proto.split(",")[0]?.trim() || "https";
  try {
    const origin = new URL(`${scheme}://${host}`).origin;
    if (isBindAddress(new URL(origin).hostname)) return null;
    return origin;
  } catch {
    return null;
  }
}

function firstHeader(req: Request, name: string): string | null {
  const value = req.headers.get(name)?.split(",")[0]?.trim();
  return value || null;
}

function isBindAddress(host: string): boolean {
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  return hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]";
}
