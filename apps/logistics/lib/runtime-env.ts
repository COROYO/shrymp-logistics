import "server-only";

/**
 * Read a secret env var at request time.
 *
 * App Hosting injects secrets only at RUNTIME; Next.js replaces static
 * `process.env.NAME` with the build-time value (undefined for secrets).
 */
export function runtimeEnv(name: string): string | undefined {
  return process.env[name];
}
