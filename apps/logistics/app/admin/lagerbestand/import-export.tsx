"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { DownloadIcon, UploadIcon } from "@/app/_components/icons";
import {
  importLagerbestandAction,
  type ImportActionState,
} from "./actions";

export function ImportExportBar() {
  const t = useTranslations("lagerbestand.io");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportActionState | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const res = await importLagerbestandAction(formData);
      setResult(res);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <section className="card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {t("title")}
          </h2>
          <p className="mt-1 text-xs text-brand-navy/60">{t("hint")}</p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <a
            href="/admin/lagerbestand/export"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/80 transition hover:border-brand-navy hover:text-brand-navy"
          >
            <DownloadIcon className="h-4 w-4" />
            {t("export")}
          </a>

          <a
            href="/admin/lagerbestand/export?charges=0"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/80 transition hover:border-brand-navy hover:text-brand-navy"
          >
            <DownloadIcon className="h-4 w-4" />
            {t("exportNoCharges")}
          </a>

          <button
            type="button"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md bg-brand-burgundy px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white transition hover:bg-brand-burgundy/90 disabled:opacity-50"
          >
            <UploadIcon className="h-4 w-4" />
            {pending ? t("importing") : t("import")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onFileChange}
          />
        </div>
      </div>

      {fileName && (
        <p className="mt-3 text-xs text-brand-navy/50">
          {t("file")}: <span className="font-mono">{fileName}</span>
        </p>
      )}

      {result && <ImportResult result={result} />}
    </section>
  );
}

function ImportResult({ result }: { result: ImportActionState }) {
  const t = useTranslations("lagerbestand.io");

  if (!result.ok) {
    return (
      <div className="mt-4 rounded-md border border-brand-burgundy/30 bg-brand-burgundy/5 px-4 py-3 text-sm text-brand-burgundy">
        {result.error}
      </div>
    );
  }

  const s = result.summary;
  const problems = s.results.filter(
    (r) => r.status === "error" || r.status === "skipped",
  );

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Pill label={t("created")} value={s.created} tone="emerald" />
        <Pill label={t("updated")} value={s.updated} tone="navy" />
        <Pill label={t("skipped")} value={s.skipped} tone="muted" />
        <Pill
          label={t("errors")}
          value={s.errors}
          tone={s.errors > 0 ? "burgundy" : "muted"}
        />
      </div>

      {problems.length > 0 && (
        <div className="overflow-hidden rounded-md border border-zinc-200">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 text-brand-navy/60">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t("row")}</th>
                <th className="px-3 py-2 text-left font-semibold">
                  {t("charge")}
                </th>
                <th className="px-3 py-2 text-left font-semibold">
                  {t("detail")}
                </th>
              </tr>
            </thead>
            <tbody>
              {problems.map((r) => (
                <tr key={`${r.row}-${r.charge}`} className="border-t border-zinc-100">
                  <td className="px-3 py-1.5 font-mono text-brand-navy/70">
                    {r.row}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-brand-navy/70">
                    {r.charge || "—"}
                  </td>
                  <td
                    className={`px-3 py-1.5 ${
                      r.status === "error"
                        ? "text-brand-burgundy"
                        : "text-brand-navy/60"
                    }`}
                  >
                    {r.message ?? r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "navy" | "muted" | "burgundy";
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-700",
    navy: "bg-brand-navy/5 text-brand-navy",
    muted: "bg-zinc-100 text-brand-navy/50",
    burgundy: "bg-brand-burgundy/10 text-brand-burgundy",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ${toneClass}`}
    >
      <span className="tabular-nums">{value}</span>
      {label}
    </span>
  );
}
