import { Fragment, type ReactNode } from "react";
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
  const showSku = branding.col_sku;
  const showBin = branding.col_bin;
  const showQty = branding.col_qty;
  const showCharge = batchesEnabled && branding.col_charge;
  const columnCount =
    1 +
    Number(showBin) +
    Number(showQty) +
    Number(showCharge);

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
          {branding.show_eyebrow && branding.eyebrow ? (
            <div
              className="text-[10pt] font-semibold uppercase tracking-[0.18em]"
              style={{ color: accent }}
            >
              {branding.eyebrow}
            </div>
          ) : null}
          <div
            className="mt-1 text-xl font-bold tracking-tight"
            style={{ color: header }}
          >
            {branding.brand_name}
          </div>
          {branding.show_address && branding.company_line ? (
            <div className="mt-1 whitespace-pre-line text-[10pt] leading-snug text-brand-navy/70">
              {branding.company_line}
            </div>
          ) : null}
          {branding.show_email && branding.contact_email ? (
            <div className="mt-0.5 text-[10pt] leading-snug text-brand-navy/70">
              {branding.contact_email}
            </div>
          ) : null}
        </div>
        {branding.show_document_title || branding.show_header_ls_no ? (
          <div className="text-right text-[10pt] text-brand-navy/70">
            {branding.show_document_title ? (
              <div
                className="text-[10pt] font-semibold uppercase tracking-[0.14em]"
                style={{ color: accent }}
              >
                {branding.document_title}
              </div>
            ) : null}
            {branding.show_header_ls_no ? (
              <div
                className="mt-1 font-mono text-base font-bold"
                style={{ color: header }}
              >
                {data.lieferschein.number}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <SlipMeta
        branding={branding}
        customerNo={order.customer?.shopify_id ?? t("noCharge")}
        lsNo={data.lieferschein.number}
        lsDate={formatGermanDate(data.lieferschein.dateIso)}
        orderNo={order.name}
        orderDate={orderDateStr}
      />

      <section className="mt-6">
        <div
          className="mb-0.5 text-[8pt] font-semibold uppercase tracking-[0.12em]"
          style={{ color: accent }}
        >
          {t("shippingAddress")}
        </div>
        <address className="not-italic text-[10pt] leading-snug">
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
            {showBin ? (
              <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
                {t("bin")}
              </th>
            ) : null}
            {showQty ? (
              <th className="px-3 py-2 pr-4 text-right text-[10pt] font-semibold uppercase tracking-[0.1em]">
                {t("qty")}
              </th>
            ) : null}
            {showCharge ? (
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
                    {showSku && section.bundle.sku ? (
                      <span
                        className="ml-2 font-mono text-brand-navy/55"
                        style={{ fontSize: `${branding.sku_size_pt}pt` }}
                      >
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
                    <div
                      className="font-semibold"
                      style={{ color: header, fontSize: `${branding.title_size_pt}pt` }}
                    >
                      {line.title}
                      {line.variantTitle ? (
                        <span className="font-normal text-brand-navy">
                          {" "}
                          {line.variantTitle}
                        </span>
                      ) : null}
                    </div>
                    {showSku && line.sku ? (
                      <div
                        className="mt-0.5 font-mono text-brand-navy/55"
                        style={{ fontSize: `${branding.sku_size_pt}pt` }}
                      >
                        {t("sku")} {line.sku}
                      </div>
                    ) : null}
                  </td>
                  {showBin ? (
                    <td className="px-3 py-2 pr-4 font-mono text-[11pt] font-bold text-brand-navy">
                      {line.binCode ?? (
                        <span className="font-normal italic text-brand-navy/40">
                          {t("noBin")}
                        </span>
                      )}
                    </td>
                  ) : null}
                  {showQty ? (
                    <td className="px-3 py-2 pr-4 text-right text-brand-navy">
                      {showCharge && line.allocs.length > 1 ? (
                        <div className="space-y-0.5">
                          {line.allocs.map((a) => (
                            <div key={a.chargeNumber}>{a.qty}</div>
                          ))}
                        </div>
                      ) : (
                        line.qty
                      )}
                    </td>
                  ) : null}
                  {showCharge ? (
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
        {branding.contact_email ? (
          <p className="mt-3">
            {t.rich("noteContact", {
              email: branding.contact_email,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        ) : null}
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

function SlipMeta({
  branding,
  customerNo,
  lsNo,
  lsDate,
  orderNo,
  orderDate,
}: {
  branding: SlipData["branding"];
  customerNo: string;
  lsNo: string;
  lsDate: string;
  orderNo: string;
  orderDate: string;
}) {
  const rows: {
    key: string;
    label: string;
    value: ReactNode;
    mono?: boolean;
  }[] = [];
  if (branding.show_customer_no) {
    rows.push({ key: "customer", label: "Kd.-Nr.", value: customerNo, mono: true });
  }
  if (branding.show_ls_no) {
    rows.push({ key: "ls", label: "Ls.-Nr.", value: lsNo, mono: true });
  }
  if (branding.show_ls_date) {
    rows.push({ key: "ls-date", label: "Ls.-Datum", value: lsDate });
  }
  if (branding.show_order_no) {
    rows.push({ key: "order", label: "Be.-Nr.", value: orderNo, mono: true });
  }
  if (branding.show_order_date) {
    rows.push({ key: "order-date", label: "Be.-Datum", value: orderDate });
  }
  if (branding.show_page) {
    rows.push({
      key: "page",
      label: "Seite",
      value: (
        <>
          1 von <span data-slip-total>1</span>
        </>
      ),
    });
  }
  if (rows.length === 0) return null;

  return (
    <section
      className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-[10pt] text-brand-navy/80"
      aria-label="Lieferschein-Metadaten"
    >
      {rows.map((row) => (
        <MetaRow
          key={row.key}
          label={row.label}
          value={row.value}
          mono={row.mono}
        />
      ))}
    </section>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
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
