/**
 * Dependency-free EAN-8 / EAN-13 encoder (GS1).
 *
 * Produces module-width bar geometry for SVG/PNG, matching the shape of
 * `encodeCode128`. UPC-A (12 digits) is accepted as EAN-13 with a leading 0.
 */

export type EanKind = "ean8" | "ean13";

export type ParsedEan = {
  kind: EanKind;
  /** Canonical digits including check digit (8 or 13). */
  digits: string;
};

export type EanBar = { x: number; width: number };

export type EanGeometry = {
  bars: EanBar[];
  modules: number;
  value: string;
  kind: EanKind;
};

// Binary patterns: 1 = bar, 0 = space. Each digit is 7 modules.
const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const G = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
const R = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];

/** First-digit parity for the six left-hand digits of an EAN-13. */
const EAN13_PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

const GUARD = "101";
const CENTER = "01010";

/** GS1 check digit for a digit string that does not yet include it. */
export function eanCheckDigit(body: string): number {
  let sum = 0;
  // Weights alternate from the right: odd positions (1-based from right) ×3.
  for (let i = 0; i < body.length; i++) {
    const fromRight = body.length - i;
    const weight = fromRight % 2 === 1 ? 3 : 1;
    sum += (body.charCodeAt(i) - 48) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

function isAllDigits(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function checkOk(digits: string): boolean {
  const body = digits.slice(0, -1);
  const check = digits.charCodeAt(digits.length - 1) - 48;
  return eanCheckDigit(body) === check;
}

/**
 * Parse a raw barcode string into a canonical EAN-8 or EAN-13.
 * Returns null when the value is not a valid EAN/UPC-A.
 */
export function parseEan(raw: string): ParsedEan | null {
  const digits = raw.trim().replace(/\s+/g, "");
  if (!isAllDigits(digits)) return null;

  if (digits.length === 8 && checkOk(digits)) {
    return { kind: "ean8", digits };
  }
  if (digits.length === 13 && checkOk(digits)) {
    return { kind: "ean13", digits };
  }
  // UPC-A → EAN-13 with leading zero.
  if (digits.length === 12 && checkOk(digits)) {
    const padded = `0${digits}`;
    if (checkOk(padded)) return { kind: "ean13", digits: padded };
  }
  return null;
}

function appendPattern(
  bars: EanBar[],
  state: { x: number },
  pattern: string,
): void {
  let run = 0;
  let runIsBar = pattern.charAt(0) === "1";
  for (let i = 0; i <= pattern.length; i++) {
    const isBar = i < pattern.length && pattern.charAt(i) === "1";
    if (i < pattern.length && isBar === runIsBar) {
      run += 1;
      continue;
    }
    if (run > 0 && runIsBar) {
      bars.push({ x: state.x, width: run });
    }
    state.x += run;
    run = 1;
    runIsBar = isBar;
  }
}

function digitPattern(set: "L" | "G" | "R", d: number): string {
  if (set === "L") return L[d]!;
  if (set === "G") return G[d]!;
  return R[d]!;
}

/**
 * Encode a canonical EAN digit string into bar geometry.
 * Prefer `encodeParsedEan` / call after `parseEan`.
 */
export function encodeEan(digits: string, quiet = 11): EanGeometry {
  const parsed = parseEan(digits);
  if (!parsed) {
    throw new Error(`invalid_ean:${digits}`);
  }
  return encodeParsedEan(parsed, quiet);
}

export function encodeParsedEan(parsed: ParsedEan, quiet = 11): EanGeometry {
  const bars: EanBar[] = [];
  const state = { x: quiet };
  const d = parsed.digits;

  appendPattern(bars, state, GUARD);

  if (parsed.kind === "ean8") {
    for (let i = 0; i < 4; i++) {
      appendPattern(bars, state, digitPattern("L", d.charCodeAt(i) - 48));
    }
    appendPattern(bars, state, CENTER);
    for (let i = 4; i < 8; i++) {
      appendPattern(bars, state, digitPattern("R", d.charCodeAt(i) - 48));
    }
  } else {
    const parity = EAN13_PARITY[d.charCodeAt(0) - 48]!;
    for (let i = 0; i < 6; i++) {
      const set = parity.charAt(i) as "L" | "G";
      appendPattern(bars, state, digitPattern(set, d.charCodeAt(i + 1) - 48));
    }
    appendPattern(bars, state, CENTER);
    for (let i = 7; i < 13; i++) {
      appendPattern(bars, state, digitPattern("R", d.charCodeAt(i) - 48));
    }
  }

  appendPattern(bars, state, GUARD);

  return {
    bars,
    modules: state.x + quiet,
    value: parsed.digits,
    kind: parsed.kind,
  };
}
