"use client";

import { useTranslations } from "next-intl";

/** On-screen controls when the slip is opened to look at, not to print immediately. */
export function SlipPreviewBar() {
  const t = useTranslations("orderDetail");
  return (
    <div className="mb-4 flex justify-end print:hidden">
      <button
        type="button"
        className="btn-secondary"
        onClick={() => window.print()}
      >
        {t("printSlip")}
      </button>
    </div>
  );
}
