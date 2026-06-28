/**
 * Minimal, dependency-free Code 128 (subset B) encoder.
 *
 * Produces the module-width geometry for an SVG barcode. Code 128-B covers the
 * printable ASCII range (32..126), which is all we need for warehouse bin codes
 * (letters, digits, "-", "/", ".", space). Standard 1D scanners — including the
 * cheap USB/Bluetooth "keyboard-wedge" guns used in warehouses — read this out
 * of the box.
 *
 * Reference: the canonical 107-entry Code 128 pattern table (each entry is the
 * widths of bar,space,bar,space,bar,space; the Stop pattern adds a final bar).
 */

// Pattern table: index 0..106 → module widths. Index 104 = Start B, 106 = Stop.
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
];

const START_B = 104;
const STOP = 106;
const ASCII_OFFSET = 32;

export type Code128Bar = { x: number; width: number };

export type Code128Geometry = {
  /** Bars to render (in module units), x measured from the quiet-zone start. */
  bars: Code128Bar[];
  /** Total width in modules including both quiet zones. */
  modules: number;
  /** The encoded value (sanitized to the supported range). */
  value: string;
};

/** Drop characters outside Code 128-B's printable range so encoding can't fail. */
export function sanitizeCode128(value: string): string {
  let out = "";
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) out += ch;
  }
  return out;
}

/**
 * Encode a string into Code 128-B barcode geometry.
 *
 * @param raw   The value to encode (sanitized to printable ASCII).
 * @param quiet Quiet-zone width in modules on each side (spec minimum is 10).
 */
export function encodeCode128(raw: string, quiet = 10): Code128Geometry {
  const value = sanitizeCode128(raw);

  const codes: number[] = [START_B];
  for (const ch of value) {
    codes.push(ch.charCodeAt(0) - ASCII_OFFSET);
  }

  // Weighted modulo-103 checksum (start value weight 1, then 1,2,3,...).
  let sum = START_B;
  for (let i = 0; i < value.length; i++) {
    sum += (value.charCodeAt(i) - ASCII_OFFSET) * (i + 1);
  }
  codes.push(sum % 103);
  codes.push(STOP);

  const bars: Code128Bar[] = [];
  let x = quiet;
  for (const code of codes) {
    const pattern = PATTERNS[code]!;
    // Each pattern alternates bar,space,bar,... starting with a bar.
    for (let i = 0; i < pattern.length; i++) {
      const w = pattern.charCodeAt(i) - 48; // fast parseInt of single digit
      if (i % 2 === 0) bars.push({ x, width: w });
      x += w;
    }
  }

  return { bars, modules: x + quiet, value };
}
