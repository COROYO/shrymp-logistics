"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { resolveScanAction } from "./actions";
import type { ScanResult } from "@/server/warehouse/scan-resolver";
import { CameraScanner } from "./camera-scanner";

export function ScanConsole() {
  const t = useTranslations("scan");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setNotFound(null);
    startTransition(async () => {
      const res = await resolveScanAction(trimmed);
      setValue("");
      inputRef.current?.focus();
      if (!res.ok) {
        setResult(null);
        setNotFound(trimmed);
        return;
      }
      if (res.result.kind === "unknown") {
        setResult(null);
        setNotFound(trimmed);
        return;
      }
      // Orders jump straight into picking — the fastest path for staff.
      if (res.result.kind === "order") {
        router.push(`/lager/picking/${res.result.orderId}`);
        return;
      }
      setResult(res.result);
    });
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("placeholder")}
            className="input-sm h-12 flex-1 min-w-[14rem] font-mono text-lg"
          />
          <button type="submit" disabled={pending} className="btn-primary h-12">
            {pending ? "…" : t("submit")}
          </button>
          <button
            type="button"
            onClick={() => setCamera((v) => !v)}
            className="btn-ghost h-12"
          >
            {camera ? t("cameraStop") : t("cameraStart")}
          </button>
        </form>
        <p className="mt-2 text-xs text-brand-navy/50">{t("hint")}</p>

        {camera ? (
          <div className="mt-4">
            <CameraScanner
              onDetect={(code) => {
                setValue(code);
                submit(code);
              }}
              onError={() => setCamera(false)}
            />
          </div>
        ) : null}
      </div>

      {notFound ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t("notFound", { code: notFound })}
        </div>
      ) : null}

      {result ? <ResultCard result={result} /> : null}
    </div>
  );
}

function ResultCard({ result }: { result: ScanResult }) {
  const t = useTranslations("scan");

  if (result.kind === "variant") {
    const v = result.variant;
    const available = v.onHand - v.reserved;
    return (
      <div className="card p-5">
        <span className="chip chip-soft">{t("result.product")}</span>
        <div className="mt-3 flex items-start gap-4">
          {v.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.imageUrl} alt="" className="h-16 w-16 rounded-md object-cover" />
          ) : null}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-brand-navy">{v.productTitle}</h2>
            <p className="text-sm text-brand-navy/60">{v.variantTitle}</p>
            <p className="mt-1 font-mono text-xs text-brand-navy/50">
              {v.sku ? `SKU ${v.sku}` : ""}
              {v.barcode ? `  ·  ${v.barcode}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label={t("result.onHand")} value={v.onHand} />
          <Stat label={t("result.reserved")} value={v.reserved} />
          <Stat label={t("result.available")} value={available} tone={available <= 0 ? "danger" : "default"} />
        </div>
        <div className="mt-4">
          <BinBadge code={v.binCode} name={v.binName} t={t} />
        </div>
      </div>
    );
  }

  if (result.kind === "bin") {
    return (
      <div className="card p-5">
        <span className="chip chip-navy">{t("result.bin")}</span>
        <div className="mt-3 flex items-center gap-3">
          <span className="rounded-md bg-brand-navy px-3 py-1.5 font-mono text-lg font-bold text-white">
            {result.code}
          </span>
          <h2 className="text-lg font-semibold text-brand-navy">{result.name}</h2>
        </div>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
          {t("result.storedHere", { count: result.variants.length })}
        </h3>
        {result.variants.length === 0 ? (
          <p className="mt-2 text-sm text-brand-navy/60">{t("result.binEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100">
            {result.variants.map((v) => (
              <li key={v.variantId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-brand-navy">{v.productTitle}</div>
                  <div className="truncate text-xs text-brand-navy/60">
                    {v.variantTitle}
                    {v.sku ? ` · ${v.sku}` : ""}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <span className="font-bold text-brand-navy">{v.onHand - v.reserved}</span>
                  <span className="text-brand-navy/50"> / {v.onHand}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return null;
}

function BinBadge({
  code,
  name,
  t,
}: {
  code: string | null;
  name: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!code) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">
        {t("result.noBin")}
        <Link href="/admin/lagerplaetze" className="font-semibold underline underline-offset-2">
          {t("result.assignBin")}
        </Link>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-md bg-brand-cream px-3 py-1.5 text-sm">
      <span className="font-mono font-bold text-brand-navy">{code}</span>
      <span className="text-brand-navy/70">{name}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-navy/45">
        {label}
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone === "danger" ? "text-red-600" : "text-brand-navy"}`}>
        {value}
      </div>
    </div>
  );
}
