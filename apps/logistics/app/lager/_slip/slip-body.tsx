"use client";

import { Fragment, type ReactNode } from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import type { SlipBrandingConfig } from "@/lib/slip/defaults";
import type { SlipViewData } from "./types";
import { buildSlipSections } from "./slip-lines";
import de from "@/messages/de.json";

const DATE_LOCALE = "de-DE";

/**
 * Packing slips stay German regardless of the warehouse UI locale.
 * A nested provider supplies only that catalog so the rest of the page
 * keeps the user's language.
 */
const SLIP_MESSAGES = { packingSlip: de.packingSlip };

export function SlipBody({
  data,
  pageBreakAfter = false,
}: {
  data: SlipViewData;
  pageBreakAfter?: boolean;
}) {
  return (
    <NextIntlClientProvider locale="de" messages={SLIP_MESSAGES}>
      <SlipDocument data={data} pageBreakAfter={pageBreakAfter} />
    </NextIntlClientProvider>
  );
}

function SlipDocument({
  data,
  pageBreakAfter = false,
}: {
  data: SlipViewData;
  pageBreakAfter?: boolean;
}) {
  const { branding, batchesEnabled } = data;
  const shipping = data.shippingAddress;
  const sections = buildSlipSections(
    data.lineItems,
    recordToMap(data.allocsByLi),
    recordToMap(data.variantTitleByLi),
    recordToMap(data.binByVariant),
  );
  const showSku = branding.col_sku;
  const showBin = branding.col_bin;
  const showQty = branding.col_qty;
  const showCharge = batchesEnabled && branding.col_charge;
  const showVariant = sections.some((section) =>
    section.lines.some((line) => line.variantTitle),
  );
  const columnCount =
    1 +
    Number(showVariant) +
    Number(showBin) +
    Number(showQty) +
    Number(showCharge);

  const t = useTranslations("packingSlip");

  const orderDate = data.createdAtIso ? new Date(data.createdAtIso) : null;
  const orderDateStr = orderDate
    ? orderDate.toLocaleDateString(DATE_LOCALE, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

  const accent = branding.accent_color;
  const header = branding.header_color;

  return (
    <article
      lang="de"
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
        customerNo={data.customerShopifyId ?? t("noCharge")}
        lsNo={data.lieferschein.number}
        lsDate={formatGermanDate(data.lieferschein.dateIso)}
        orderNo={data.orderName}
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
            {shipping?.first_name} {shipping?.last_name}
          </strong>
          {shipping?.company ? (
            <>
              <br />
              {shipping.company}
            </>
          ) : null}
          <br />
          {shipping?.address1}
          {shipping?.address2 ? (
            <>
              <br />
              {shipping.address2}
            </>
          ) : null}
          <br />
          {shipping?.zip} {shipping?.city}
          <br />
          {shipping?.country}
        </address>
      </section>

      <table className="mt-6 w-full border-collapse text-[11pt]">
        <thead>
          <tr className="text-left text-white" style={{ backgroundColor: header }}>
            <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
              {t("product")}
            </th>
            {showVariant ? (
              <th className="w-[26%] px-3 py-2 pl-10 text-[10pt] font-semibold uppercase tracking-[0.1em]">
                {t("variant")}
              </th>
            ) : null}
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
                  {showVariant ? (
                    <td className="w-[26%] px-3 py-2 pl-10 align-top text-brand-navy">
                      {line.variantTitle ? (
                        <div style={{ fontSize: `${branding.title_size_pt}pt` }}>
                          {line.variantTitle}
                        </div>
                      ) : null}
                    </td>
                  ) : null}
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

      <section className="mt-12 flex items-start justify-between gap-8 text-[10pt] leading-relaxed text-brand-navy/80">
        <div className="min-w-0 flex-1">
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
        </div>
        {data.qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- merchant-supplied URL, printed as-is
          <img
            src={data.qrDataUrl}
            alt="QR-Code"
            width={128}
            height={128}
            className="h-[32mm] w-[32mm] shrink-0 object-contain"
          />
        ) : null}
      </section>

      <footer className="mt-16 flex justify-between gap-4 border-t border-zinc-300 pt-2 text-[8pt] text-brand-navy/60">
        <span>
          {t.rich("footerOrder", {
            order: data.orderName,
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
  branding: SlipBrandingConfig;
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

function recordToMap<T>(record: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(record));
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
