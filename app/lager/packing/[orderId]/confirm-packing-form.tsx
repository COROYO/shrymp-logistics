"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { confirmPackingAction } from "../actions";

export function ConfirmPackingForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const t = useTranslations("confirmPacking");
  const [pending, startTransition] = useTransition();
  const [carrier, setCarrier] = useState("DHL");
  const [number, setNumber] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setErr(null);
    const tracking =
      number.trim().length > 0
        ? { carrier: carrier.trim() || undefined, number: number.trim() }
        : null;
    startTransition(async () => {
      const res = await confirmPackingAction(orderId, tracking);
      if (res.ok) {
        router.push("/lager/picking");
        router.refresh();
      } else {
        setErr(res.error);
        setConfirming(false);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="carrier"
            className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70"
          >
            {t("carrier")}
          </label>
          <input
            id="carrier"
            type="text"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            maxLength={80}
            className="mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-brand-ink shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
        </div>
        <div>
          <label
            htmlFor="number"
            className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70"
          >
            {t("tracking")}
          </label>
          <input
            id="number"
            type="text"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            maxLength={80}
            placeholder={t("trackingPlaceholder")}
            className="mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-brand-ink shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`w-full rounded-md px-4 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
          confirming
            ? "bg-emerald-700 hover:bg-emerald-800"
            : "bg-brand-burgundy hover:bg-brand-burgundy-dark"
        }`}
      >
        {pending ? t("submitting") : confirming ? t("confirm") : t("submit")}
      </button>
      {err ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
          {t("errorPrefix")} {err}
        </div>
      ) : null}
    </div>
  );
}
