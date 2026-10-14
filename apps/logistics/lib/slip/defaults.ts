/** Visibility flags for the packing-slip letterhead, meta block, and columns. */
export const SLIP_LAYOUT_FLAG_KEYS = [
  "show_eyebrow",
  "show_address",
  "show_email",
  "show_document_title",
  "show_header_ls_no",
  "show_customer_no",
  "show_ls_no",
  "show_ls_date",
  "show_order_no",
  "show_order_date",
  "show_page",
  "col_sku",
  "col_bin",
  "col_qty",
  "col_charge",
] as const;

export type SlipLayoutFlag = (typeof SLIP_LAYOUT_FLAG_KEYS)[number];

/** Print sizes for the line-item title and the Art.-Nr. under it. */
export const SLIP_FONT_SIZE_MIN_PT = 6;
export const SLIP_FONT_SIZE_MAX_PT = 18;
export const DEFAULT_TITLE_SIZE_PT = 11;
export const DEFAULT_SKU_SIZE_PT = 9;

const DEFAULT_LAYOUT_FLAGS: Record<SlipLayoutFlag, boolean> = {
  show_eyebrow: true,
  show_address: true,
  show_email: true,
  show_document_title: true,
  show_header_ls_no: true,
  show_customer_no: true,
  show_ls_no: true,
  show_ls_date: true,
  show_order_no: true,
  show_order_date: true,
  show_page: true,
  col_sku: true,
  col_bin: true,
  col_qty: true,
  col_charge: true,
};

/** Default packing-slip branding (SHRYMP platform — overridden per shop). */
export const DEFAULT_SLIP_BRANDING = {
  brand_name: "SHRYMP",
  eyebrow: "Lager neu gedacht",
  company_line: "lager.shrymp.de",
  contact_email: "roman@shrymp.de",
  accent_color: "#F3ACC8",
  header_color: "#0f1b33",
  document_title: "Lieferschein",
  signature: "Vielen Dank für deine Bestellung!\nDein SHRYMP-Team",
  footer_legal: "SHRYMP · lager.shrymp.de",
  title_size_pt: DEFAULT_TITLE_SIZE_PT,
  sku_size_pt: DEFAULT_SKU_SIZE_PT,
  ...DEFAULT_LAYOUT_FLAGS,
} as const;

export type SlipBrandingConfig = {
  brand_name: string;
  eyebrow: string;
  /** Sender address in the letterhead. Newlines are printed as separate lines. */
  company_line: string;
  contact_email: string;
  accent_color: string;
  header_color: string;
  document_title: string;
  signature: string;
  footer_legal: string;
  /** Line-item title size on the printed slip, in points. */
  title_size_pt: number;
  /** Art.-Nr. size on the printed slip, in points. */
  sku_size_pt: number;
} & Record<SlipLayoutFlag, boolean>;

function layoutFlags(
  partial?: Partial<SlipBrandingConfig> | null,
): Record<SlipLayoutFlag, boolean> {
  const flags = { ...DEFAULT_LAYOUT_FLAGS };
  if (!partial) return flags;
  for (const key of SLIP_LAYOUT_FLAG_KEYS) {
    const value = partial[key];
    if (typeof value === "boolean") flags[key] = value;
  }
  return flags;
}

function sizePt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  if (value < SLIP_FONT_SIZE_MIN_PT || value > SLIP_FONT_SIZE_MAX_PT) return fallback;
  return value;
}

export function resolveSlipBranding(
  partial?: Partial<SlipBrandingConfig> | null,
): SlipBrandingConfig {
  if (!partial) return { ...DEFAULT_SLIP_BRANDING };
  return {
    brand_name: partial.brand_name?.trim() || DEFAULT_SLIP_BRANDING.brand_name,
    eyebrow: partial.eyebrow?.trim() || DEFAULT_SLIP_BRANDING.eyebrow,
    company_line:
      partial.company_line?.trim() || DEFAULT_SLIP_BRANDING.company_line,
    contact_email:
      partial.contact_email?.trim() || DEFAULT_SLIP_BRANDING.contact_email,
    accent_color:
      partial.accent_color?.trim() || DEFAULT_SLIP_BRANDING.accent_color,
    header_color:
      partial.header_color?.trim() || DEFAULT_SLIP_BRANDING.header_color,
    document_title:
      partial.document_title?.trim() || DEFAULT_SLIP_BRANDING.document_title,
    signature: partial.signature?.trim() || DEFAULT_SLIP_BRANDING.signature,
    footer_legal:
      partial.footer_legal?.trim() || DEFAULT_SLIP_BRANDING.footer_legal,
    title_size_pt: sizePt(partial.title_size_pt, DEFAULT_TITLE_SIZE_PT),
    sku_size_pt: sizePt(partial.sku_size_pt, DEFAULT_SKU_SIZE_PT),
    ...layoutFlags(partial),
  };
}
