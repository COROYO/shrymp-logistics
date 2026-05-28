import { getTranslations } from "next-intl/server";
import { tsToDate, type SlipData } from "@/server/picking/slip-data";

const DATE_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
};

/**
 * Renders the body of a packing slip. Used by both:
 *   - /lager/picking/[orderId]/slip (single, prints immediately)
 *   - /lager/print-slips?ids=... (bulk, stacks multiple with page-breaks)
 *
 * Locale is pinned to German — the packing slip is a printed document
 * tied to the German operating entity (Ikrinka GmbH), so we keep it
 * consistent regardless of customer country or warehouse user locale.
 */
export async function SlipBody({
  data,
  pageBreakAfter = false,
}: {
  data: SlipData;
  pageBreakAfter?: boolean;
}) {
  const { order, allocsByLi } = data;

  const locale = "de" as const;
  const t = await getTranslations({ locale, namespace: "packingSlip" });
  const dateLocale = DATE_LOCALE[locale] ?? "de-DE";

  const fmtDate = (iso: string | null): string => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(dateLocale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const orderDate = tsToDate(order.created_at_shopify);
  const orderDateStr = orderDate
    ? orderDate.toLocaleDateString(dateLocale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

  const firstName = order.shipping_address?.first_name ?? t("fallbackName");

  return (
    <article
      lang={locale}
      className="mx-auto max-w-[210mm] bg-white p-10 text-[12pt] text-brand-ink print:p-0"
      style={pageBreakAfter ? { pageBreakAfter: "always" } : undefined}
    >
      <header className="flex items-start justify-between border-b-[3px] border-brand-burgundy pb-3">
        <div>
          <div className="text-[10pt] font-semibold uppercase tracking-[0.18em] text-brand-burgundy">
            {t("eyebrow")}
          </div>
          <div className="mt-1 text-xl font-bold tracking-tight text-brand-navy">
            {t("brand")}
          </div>
          <div className="mt-1 text-[10pt] leading-snug text-brand-navy/70">
            {t("companyLine")}
            <br />
            {t("contactEmail")}
          </div>
        </div>
        <div className="text-right text-[10pt] text-brand-navy/70">
          <div className="text-[10pt] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
            {t("title")}
          </div>
          <div className="mt-1 font-mono text-base font-bold text-brand-navy">
            {data.lieferschein.number}
          </div>
        </div>
      </header>

      {/* Pflicht-Metadaten-Block (DE) — Kd/Ls/Be-Nummern + Daten + Seite */}
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
        <MetaRow label="Seite" value="1 von 1" />
      </section>

      <section className="mt-10">
        <div className="mb-1 text-[10pt] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
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
          <tr className="bg-brand-navy text-left text-white">
            <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
              {t("product")}
            </th>
            <th className="px-3 py-2 pr-4 text-right text-[10pt] font-semibold uppercase tracking-[0.1em]">
              {t("qty")}
            </th>
            <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
              {t("charge")}
            </th>
          </tr>
        </thead>
        <tbody>
          {order.line_items.map((li) => {
            const allocs = allocsByLi.get(li.id) ?? [];
            if (allocs.length === 0) {
              return (
                <tr key={li.id} className="border-b border-zinc-300">
                  <td className="px-3 py-2 pr-4">
                    <div className="font-semibold text-brand-navy">
                      {li.title}
                    </div>
                  </td>
                  <td className="px-3 py-2 pr-4 text-right">{li.qty}</td>
                  <td className="px-3 py-2 pr-4 italic text-brand-navy/40">
                    {t("noCharge")}
                  </td>
                  <td className="px-3 py-2 italic text-brand-navy/40">
                    {t("noCharge")}
                  </td>
                </tr>
              );
            }
            return allocs.map((a, idx) => (
              <tr
                key={`${li.id}-${idx}`}
                className="border-b border-zinc-300 align-top"
              >
                <td className="px-3 py-2 pr-4">
                  {idx === 0 ? (
                    <div className="font-semibold text-brand-navy">
                      {li.title}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 pr-4 text-right">{a.qty}</td>
                <td className="px-3 py-2 pr-4 font-mono">{a.chargeNumber}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>

      <section className="mt-12 text-[10pt] leading-relaxed text-brand-navy/80">
        <p className="mt-3">
          {t.rich("noteContact", {
            email: t("contactEmail"),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        <p className="mt-6 font-medium whitespace-pre-line">{t("signature")}</p>
      </section>

      <footer className="mt-16 flex justify-between border-t border-zinc-300 pt-2 text-[8pt] text-brand-navy/60">
        <span>
          {t.rich("footerOrder", {
            order: order.name,
            mono: (chunks) => <span className="font-mono">{chunks}</span>,
          })}
        </span>
        <span>{t("footerLegal")}</span>
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
