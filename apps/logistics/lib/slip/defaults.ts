/** Default packing-slip branding (SHRYMP platform — overridden per shop). */
export const DEFAULT_SLIP_BRANDING = {
  brand_name: "SHRYMP",
  eyebrow: "Lager neu gedacht",
  company_line: "lager.shrymp.de",
  contact_email: "hello@shrymp.de",
  accent_color: "#F3ACC8",
  header_color: "#0f1b33",
  document_title: "Lieferschein",
  signature: "Vielen Dank für deine Bestellung!\nDein SHRYMP-Team",
  footer_legal: "SHRYMP · lager.shrymp.de",
} as const;

export type SlipBrandingConfig = {
  brand_name: string;
  eyebrow: string;
  company_line: string;
  contact_email: string;
  accent_color: string;
  header_color: string;
  document_title: string;
  signature: string;
  footer_legal: string;
};

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
  };
}
