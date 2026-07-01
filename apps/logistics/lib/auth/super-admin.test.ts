import { afterEach, describe, expect, it } from "vitest";
import { isSuperAdminEmail } from "@/lib/auth/super-admin";

describe("isSuperAdminEmail", () => {
  afterEach(() => {
    delete process.env.SUPER_ADMIN_EMAILS;
  });

  it("matches configured emails case-insensitively", () => {
    process.env.SUPER_ADMIN_EMAILS =
      "roman@shrymp-commerce.com, ops@Example.COM ";
    expect(isSuperAdminEmail("Roman@Shrymp-Commerce.com")).toBe(true);
    expect(isSuperAdminEmail("ops@example.com")).toBe(true);
    expect(isSuperAdminEmail("other@example.com")).toBe(false);
  });

  it("returns false when unset or empty", () => {
    expect(isSuperAdminEmail("roman@shrymp-commerce.com")).toBe(false);
    process.env.SUPER_ADMIN_EMAILS = "  ,  ";
    expect(isSuperAdminEmail("roman@shrymp-commerce.com")).toBe(false);
  });
});
