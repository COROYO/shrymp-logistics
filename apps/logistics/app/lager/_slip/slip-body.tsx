import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import { tsToDate, type SlipData } from "@/server/picking/slip-data";
import { buildSlipSections } from "./slip-lines";

const DATE_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  pl: "pl-PL",
  tr: "tr-TR",
};

export async function SlipBody({
  data,
  pageBreakAfter = false,
}: {
  data: SlipData;
  pageBreakAfter?: boolean;
}) {
  const { order, allocsByLi, variantTitleByLi, branding, batchesEnabled, binByVariant } =
    data;
  const sections = buildSlipSections(
    order.line_items,
    allocsByLi,
    variantTitleByLi,
    binByVariant,
  );
  const columnCount = batchesEnabled ? 4 : 3;

  const locale = "de" as const;
  const t = await getTranslations({ locale, namespace: "packingSlip" });
  const dateLocale = DATE_LOCALE[locale] ?? "de-DE";

  const orderDate = tsToDate(order.created_at_shopify);
  const orderDateStr = orderDate
    ? orderDate.toLocaleDateString(dateLocale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

  const accent = branding.accent_color;
  const header = branding.header_color;

  return (
    <article
      lang={locale}
      data-slip-article
      className="mx-auto mt-10 max-w-[210mm] bg-white p-10 text-[12pt] text-brand-ink print:mt-0 print:p-0"
      style={pageBreakAfter ? { pageBreakAfter: "always" } : undefined}
    >
      <header
        className="flex items-start justify-between border-b-[3px] pb-3"
        style={{ borderColor: accent }}
      >
        <div>
          <div
            className="text-[10pt] font-semibold uppercase tracking-[0.18em]"
            style={{ color: accent }}
          >
            {branding.eyebrow}
          </div>
          <div
            className="mt-1 text-xl font-bold tracking-tight"
            style={{ color: header }}
          >
            {branding.brand_name}
          </div>
          <div className="mt-1 text-[10pt] leading-snug text-brand-navy/70">
            {branding.company_line}
            <br />
            {branding.contact_email}
          </div>
        </div>
        <div className="text-right text-[10pt] text-brand-navy/70">
          <div
            className="text-[10pt] font-semibold uppercase tracking-[0.14em]"
            style={{ color: accent }}
          >
            {branding.document_title}
          </div>
          <div
            className="mt-1 font-mono text-base font-bold"
            style={{ color: header }}
          >
            {data.lieferschein.number}
          </div>
        </div>
      </header>

      <section
        className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-[10pt] text-brand-navy/80"
        aria-label="Lieferschein-Metadaten"
      >
        <MetaRow
          label="Kd.-Nr."
          value={order.customer?.shopify_id ?? t("noCharge")}
          mono
        />
        <MetaRow label="Ls.-Nr." value={data.lieferschein.number} mono />
        <MetaRow
          label="Ls.-Datum"
          value={formatGermanDate(data.lieferschein.dateIso)}
        />
        <MetaRow label="Be.-Nr." value={order.name} mono />
        <MetaRow label="Be.-Datum" value={orderDateStr} />
        <div className="flex items-baseline gap-2">
          <span className="min-w-[80px] text-[10pt] font-semibold text-brand-navy/60">
            Seite
          </span>
          <span className="text-[11pt] text-brand-navy">
            1 von <span data-slip-total>1</span>
          </span>
        </div>
      </section>

      <section className="mt-10">
        <div
          className="mb-1 text-[10pt] font-semibold uppercase tracking-[0.14em]"
          style={{ color: accent }}
        >
          {t("shippingAddress")}
        </div>
        <address className="not-italic text-[14pt] leading-relaxed">
          <strong>
            {order.shipping_address?.first_name}{" "}
            {order.shipping_address?.last_name}
          </strong>
          {order.shipping_address?.company ? (
            <>
              <br />
              {order.shipping_address.company}
            </>
          ) : null}
          <br />
          {order.shipping_address?.address1}
          {order.shipping_address?.address2 ? (
            <>
              <br />
              {order.shipping_address.address2}
            </>
          ) : null}
          <br />
          {order.shipping_address?.zip} {order.shipping_address?.city}
          <br />
          {order.shipping_address?.country}
        </address>
      </section>

      <table className="mt-6 w-full border-collapse text-[11pt]">
        <thead>
          <tr className="text-left text-white" style={{ backgroundColor: header }}>
            <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
              {t("product")}
            </th>
            <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
              {t("bin")}
            </th>
            <th className="px-3 py-2 pr-4 text-right text-[10pt] font-semibold uppercase tracking-[0.1em]">
              {t("qty")}
            </th>
            {batchesEnabled ? (
              <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
                {t("charge")}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.key}>
              {section.bundle ? (
                <tr
                  className="border-b border-l-4 border-zinc-300"
                  style={{
                    borderLeftColor: accent,
                    backgroundColor: `color-mix(in srgb, ${accent} 8%, white)`,
                  }}
                >
                  <td colSpan={columnCount} className="px-3 py-2">
                    <span
                      className="text-[9pt] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: header }}
                    >
                      {t("bundle")}
                    </span>{" "}
                    <span className="font-semibold" style={{ color: header }}>
                      {section.bundle.title}
                    </span>
                    {section.bundle.quantity > 1 ? (
                      <span className="text-brand-navy/70">
                        {" "}
                        × {section.bundle.quantity}
                      </span>
                    ) : null}
                    {section.bundle.sku ? (
                      <span className="ml-2 font-mono text-[9pt] text-brand-navy/55">
                        {t("sku")} {section.bundle.sku}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ) : null}
              {section.lines.map((line) => (
                <tr
                  key={line.key}
                  className={`border-b border-zinc-300 align-top ${
                    section.bundle ? "border-l-4" : ""
                  }`}
                  style={
                    section.bundle
                      ? { borderLeftColor: `color-mix(in srgb, ${accent} 35%, white)` }
                      : undefined
                  }
                >
                  <td className={`px-3 py-2 pr-4 ${section.bundle ? "pl-6" : ""}`}>
                    <div className="font-semibold" style={{ color: header }}>
                      {line.title}
                      {line.variantTitle ? (
                        <span className="font-normal text-brand-navy">
                          {" "}
                          {line.variantTitle}
                        </span>
                      ) : null}
                    </div>
                    {line.sku ? (
                      <div className="mt-0.5 font-mono text-[9pt] text-brand-navy/55">
                        {t("sku")} {line.sku}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 pr-4 font-mono text-[11pt] font-bold text-brand-navy">
                    {line.binCode ?? (
                      <span className="font-normal italic text-brand-navy/40">
                        {t("noBin")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 pr-4 text-right text-brand-navy">
                    {line.allocs.length > 1 ? (
                      <div className="space-y-0.5">
                        {line.allocs.map((a) => (
                          <div key={a.chargeNumber}>{a.qty}</div>
                        ))}
                      </div>
                    ) : (
                      line.qty
                    )}
                  </td>
                  {batchesEnabled ? (
                    <td className="px-3 py-2 pr-4 font-mono">
                      {line.allocs.length === 0 ? (
                        <span className="italic text-brand-navy/40">
                          {t("noCharge")}
                        </span>
                      ) : line.allocs.length === 1 ? (
                        line.allocs[0]!.chargeNumber
                      ) : (
                        <div className="space-y-0.5">
                          {line.allocs.map((a) => (
                            <div key={a.chargeNumber}>{a.chargeNumber}</div>
                          ))}
                        </div>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <section className="mt-12 text-[10pt] leading-relaxed text-brand-navy/80">
        <p className="mt-3">
          {t.rich("noteContact", {
            email: branding.contact_email,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        <p className="mt-6 font-medium whitespace-pre-line">
          {branding.signature}
        </p>
      </section>

      <footer className="mt-16 flex justify-between gap-4 border-t border-zinc-300 pt-2 text-[8pt] text-brand-navy/60">
        <span>
          {t.rich("footerOrder", {
            order: order.name,
            mono: (chunks) => <span className="font-mono">{chunks}</span>,
          })}
          {" · Lieferschein "}
          <span className="font-mono">{data.lieferschein.number}</span>
          {" · "}
          <span data-slip-total>1</span>
          {" Seite(n)"}
        </span>
        <span className="max-w-[55%] text-right">{branding.footer_legal}</span>
      </footer>
    </article>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="min-w-[80px] text-[10pt] font-semibold text-brand-navy/60">
        {label}
      </span>
      <span
        className={`text-[11pt] text-brand-navy ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function formatGermanDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
