import { describe, expect, it } from "vitest";
import { detectSlipQrFormat } from "./qr-image";

describe("detectSlipQrFormat", () => {
  it("recognizes PNG, JPEG, and WebP headers", () => {
    const png = new Uint8Array(16);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    expect(detectSlipQrFormat(png)).toBe("png");

    const jpeg = new Uint8Array(16);
    jpeg.set([0xff, 0xd8, 0xff], 0);
    expect(detectSlipQrFormat(jpeg)).toBe("jpeg");

    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(detectSlipQrFormat(webp)).toBe("webp");
  });

  it("rejects other files", () => {
    expect(detectSlipQrFormat(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBe(
      null,
    );
  });
});
