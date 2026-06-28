import { encodeCode128 } from "./code128";

export type BarcodePngOptions = {
  /** Pixel width of a single module (the smallest bar unit). */
  moduleWidth?: number;
  /** Bar height in pixels. */
  height?: number;
  /** Draw the human-readable value below the bars. */
  showValue?: boolean;
  /** Vertical white padding (top + bottom) in pixels. */
  paddingY?: number;
};

/**
 * Rasterize a Code 128-B barcode to a PNG `Blob` via an offscreen canvas.
 *
 * Browser-only — must be called from client code (uses `document`). Bars are
 * drawn straight from the encoder geometry (no SVG rasterization), so the PNG
 * is crisp and the canvas never gets tainted.
 */
export async function barcodeToPngBlob(
  raw: string,
  opts: BarcodePngOptions = {},
): Promise<Blob | null> {
  const { moduleWidth = 3, height = 80, showValue = true, paddingY = 12 } = opts;
  const geo = encodeCode128(raw);
  const barWidth = geo.modules * moduleWidth;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const fontSize = 16;
  const font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const textGap = showValue && geo.value ? fontSize + 6 : 0;

  ctx.font = font;
  const textWidth = showValue && geo.value ? ctx.measureText(geo.value).width : 0;

  const width = Math.ceil(Math.max(barWidth, textWidth) + 8);
  const totalHeight = Math.ceil(height + textGap + paddingY * 2);
  canvas.width = width;
  canvas.height = totalHeight;

  // Resizing the canvas resets the 2D context, so re-apply text state.
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, totalHeight);

  const barOffsetX = (width - barWidth) / 2;
  ctx.fillStyle = "#000000";
  for (const b of geo.bars) {
    ctx.fillRect(barOffsetX + b.x * moduleWidth, paddingY, b.width * moduleWidth, height);
  }

  if (showValue && geo.value) {
    ctx.fillText(geo.value, width / 2, paddingY + height + fontSize);
  }

  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), "image/png"),
  );
}
