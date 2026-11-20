import { afterEach, describe, expect, it } from "vitest";
import { readLocalSession, signLocalSession } from "./local-session";

describe("local session cookie", () => {
  const previous = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = previous;
  });

  it("round-trips a signed session and rejects tampering", () => {
    process.env.CRON_SECRET = "test-secret";
    const now = Date.UTC(2026, 0, 1);
    const token = signLocalSession(
      { uid: "user-1", email: "a@example.com", role: "ADMIN" },
      now,
    );

    expect(readLocalSession(token, now)).toEqual({
      uid: "user-1",
      email: "a@example.com",
      role: "ADMIN",
    });

    const [version, payload, sig] = token.split(".");
    expect(readLocalSession(`${version}.${payload}.${sig}x`, now)).toBeNull();
    expect(readLocalSession(token, now + 8 * 24 * 60 * 60 * 1000)).toBeNull();
    expect(readLocalSession("eyJhbGciOiJSUzI1NiJ9.payload.sig", now)).toBeNull();
  });
});