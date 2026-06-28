"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import {
  assignVariantAction,
  bulkCreateBinsAction,
  createBinAction,
  deleteBinAction,
  listAssignableVariantsAction,
  listBinsAction,
  updateBinAction,
} from "./actions";
import type { AssignableVariant, BinRow } from "@/server/warehouse/bins";

export function BinsManager() {
  const t = useTranslations("bins");
  const [bins, setBins] = useState<BinRow[] | null>(null);
  const [variants, setVariants] = useState<AssignableVariant[] | null>(null);
  const [pending, startTransition] = useTransition();

  function transErr(code: string): string {
    return t.has(`errors.${code}`) ? t(`errors.${code}`) : code;
  }

  function reload() {
    listBinsAction().then((res) => {
      if (res.ok) setBins(res.rows);
      else dispatchAdminJobError({ title: t("title"), message: transErr(res.error) });
    });
    listAssignableVariantsAction().then((res) => {
      if (res.ok) setVariants(res.variants);
    });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <CreateBins t={t} pending={pending} startTransition={startTransition} onDone={reload} transErr={transErr} />
      <BinList
        t={t}
        bins={bins}
        pending={pending}
        startTransition={startTransition}
        onDone={reload}
        transErr={transErr}
      />
      <AssignSection
        t={t}
        bins={bins}
        variants={variants}
        pending={pending}
        startTransition={startTransition}
        onDone={reload}
        transErr={transErr}
      />
    </div>
  );
}

type Common = {
  t: ReturnType<typeof useTranslations>;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  onDone: () => void;
  transErr: (code: string) => string;
};

function CreateBins({ t, pending, startTransition, onDone, transErr }: Common) {
  const [mode, setMode] = useState<"single" | "bulk">("single");

  function handleSingle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    startTransition(async () => {
      const res = await createBinAction({
        code: String(fd.get("code") ?? ""),
        name: String(fd.get("name") ?? ""),
        zone: String(fd.get("zone") ?? "") || undefined,
        note: String(fd.get("note") ?? "") || undefined,
      });
      if (res.ok) {
        dispatchAdminJobSuccess({ title: t("title"), message: t("created", { code: res.row.code }) });
        form.reset();
        onDone();
      } else {
        dispatchAdminJobError({ title: t("title"), message: transErr(res.error) });
      }
    });
  }

  function handleBulk(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await bulkCreateBinsAction({
        prefix: String(fd.get("prefix") ?? ""),
        suffix: String(fd.get("suffix") ?? "") || undefined,
        start: Number(fd.get("start") ?? 1),
        count: Number(fd.get("count") ?? 0),
        padding: Number(fd.get("padding") ?? 2),
        zone: String(fd.get("zone") ?? "") || undefined,
        namePrefix: String(fd.get("namePrefix") ?? "") || undefined,
      });
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: t("title"),
          message: t("bulkDone", { created: res.created, skipped: res.skipped }),
        });
        onDone();
      } else {
        dispatchAdminJobError({ title: t("title"), message: transErr(res.error) });
      }
    });
  }

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">{t("create.eyebrow")}</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {t("create.title")}
          </h2>
        </div>
        <div className="flex gap-1 rounded-md bg-zinc-100 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`rounded px-3 py-1 font-semibold ${mode === "single" ? "bg-white text-brand-navy shadow-sm" : "text-brand-navy/60"}`}
          >
            {t("create.single")}
          </button>
          <button
            type="button"
            onClick={() => setMode("bulk")}
            className={`rounded px-3 py-1 font-semibold ${mode === "bulk" ? "bg-white text-brand-navy shadow-sm" : "text-brand-navy/60"}`}
          >
            {t("create.bulk")}
          </button>
        </div>
      </div>

      {mode === "single" ? (
        <form onSubmit={handleSingle} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("fields.code")} name="code" required placeholder="A-01-02" />
          <Field label={t("fields.name")} name="name" required placeholder="Regal A · Fach 1" />
          <Field label={t("fields.zone")} name="zone" placeholder="Zone A" />
          <Field label={t("fields.note")} name="note" />
          <div className="sm:col-span-2">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "…" : t("create.add")}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleBulk} className="mt-4 space-y-3">
          <p className="text-xs text-brand-navy/60">{t("create.bulkHint")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("fields.prefix")} name="prefix" defaultValue="A-" />
            <Field label={t("fields.start")} name="start" type="number" defaultValue="1" />
            <Field label={t("fields.count")} name="count" type="number" defaultValue="20" required />
            <Field label={t("fields.padding")} name="padding" type="number" defaultValue="2" />
            <Field label={t("fields.suffix")} name="suffix" />
            <Field label={t("fields.zone")} name="zone" placeholder="Zone A" />
          </div>
          <Field label={t("fields.namePrefix")} name="namePrefix" placeholder="Lagerplatz" />
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "…" : t("create.generate")}
          </button>
        </form>
      )}
    </section>
  );
}

function BinList({
  t,
  bins,
  pending,
  startTransition,
  onDone,
  transErr,
}: Common & { bins: BinRow[] | null }) {
  const [editing, setEditing] = useState<string | null>(null);

  if (bins === null) {
    return <p className="text-sm text-brand-navy/50">{t("loading")}</p>;
  }

  function handleDelete(bin: BinRow) {
    if (!confirm(t("confirmDelete", { code: bin.code, count: bin.variantCount }))) return;
    startTransition(async () => {
      const res = await deleteBinAction(bin.id);
      if (res.ok) {
        dispatchAdminJobSuccess({ title: t("title"), message: t("deleted", { code: bin.code }) });
        onDone();
      } else {
        dispatchAdminJobError({ title: t("title"), message: transErr(res.error) });
      }
    });
  }

  function handleSaveEdit(bin: BinRow, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateBinAction(bin.id, {
        code: String(fd.get("code") ?? ""),
        name: String(fd.get("name") ?? ""),
        zone: String(fd.get("zone") ?? ""),
      });
      if (res.ok) {
        dispatchAdminJobSuccess({ title: t("title"), message: t("updated", { code: bin.code }) });
        setEditing(null);
        onDone();
      } else {
        dispatchAdminJobError({ title: t("title"), message: transErr(res.error) });
      }
    });
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-brand-navy">
          {t("list.title", { count: bins.length })}
        </h2>
      </div>
      {bins.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-brand-navy/60">
          {t("list.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {bins.map((bin) => (
            <li key={bin.id} className="px-6 py-3">
              {editing === bin.id ? (
                <form onSubmit={(e) => handleSaveEdit(bin, e)} className="grid gap-2 sm:grid-cols-4">
                  <input name="code" defaultValue={bin.code} className="input-sm font-mono" required />
                  <input name="name" defaultValue={bin.name} className="input-sm sm:col-span-2" required />
                  <input name="zone" defaultValue={bin.zone ?? ""} className="input-sm" placeholder="Zone" />
                  <div className="flex gap-2 sm:col-span-4">
                    <button type="submit" disabled={pending} className="btn-primary text-xs">
                      {t("save")}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="btn-ghost text-xs">
                      {t("cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded-md bg-brand-navy px-2.5 py-1 font-mono text-sm font-bold text-white">
                      {bin.code}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-brand-navy">{bin.name}</div>
                      <div className="text-xs text-brand-navy/50">
                        {bin.zone ? `${bin.zone} · ` : ""}
                        {t("list.variantCount", { count: bin.variantCount })}
                        {!bin.active ? ` · ${t("list.inactive")}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.1em]">
                    <button type="button" onClick={() => setEditing(bin.id)} className="text-brand-navy/70 hover:text-brand-burgundy">
                      {t("edit")}
                    </button>
                    <button type="button" onClick={() => handleDelete(bin)} className="text-red-600 hover:text-red-700">
                      {t("delete")}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AssignSection({
  t,
  bins,
  variants,
  pending,
  startTransition,
  onDone,
  transErr,
}: Common & { bins: BinRow[] | null; variants: AssignableVariant[] | null }) {
  const [query, setQuery] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const filtered = useMemo(() => {
    if (!variants) return [];
    const q = query.trim().toLowerCase();
    return variants.filter((v) => {
      if (onlyUnassigned && v.binId) return false;
      if (!q) return true;
      return (
        v.productTitle.toLowerCase().includes(q) ||
        v.variantTitle.toLowerCase().includes(q) ||
        (v.sku ?? "").toLowerCase().includes(q) ||
        (v.barcode ?? "").toLowerCase().includes(q)
      );
    });
  }, [variants, query, onlyUnassigned]);

  function handleAssign(variantId: string, binId: string) {
    startTransition(async () => {
      const res = await assignVariantAction(variantId, binId || null);
      if (res.ok) onDone();
      else dispatchAdminJobError({ title: t("title"), message: transErr(res.error) });
    });
  }

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-zinc-200 px-6 py-4">
        <p className="eyebrow">{t("assign.eyebrow")}</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">{t("assign.title")}</h2>
        <p className="mt-1 text-xs text-brand-navy/60">{t("assign.intro")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("assign.search")}
            className="input-sm w-64"
          />
          <label className="flex items-center gap-2 text-xs text-brand-navy/70">
            <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
            {t("assign.onlyUnassigned")}
          </label>
        </div>
      </div>

      {variants === null ? (
        <p className="px-6 py-10 text-center text-sm text-brand-navy/50">{t("loading")}</p>
      ) : filtered.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-brand-navy/60">{t("assign.empty")}</p>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto">
          <table className="table-brand">
            <thead>
              <tr>
                <th>{t("assign.product")}</th>
                <th>{t("assign.sku")}</th>
                <th>{t("assign.bin")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.variantId}>
                  <td>
                    <div className="font-semibold text-brand-navy">{v.productTitle}</div>
                    <div className="text-xs text-brand-navy/60">{v.variantTitle}</div>
                  </td>
                  <td className="font-mono text-xs text-brand-navy/70">
                    {v.sku ?? "—"}
                    {v.barcode ? <div className="text-brand-navy/40">{v.barcode}</div> : null}
                  </td>
                  <td>
                    <select
                      value={v.binId ?? ""}
                      disabled={pending}
                      onChange={(e) => handleAssign(v.variantId, e.target.value)}
                      className="input-sm min-w-[10rem]"
                    >
                      <option value="">{t("assign.none")}</option>
                      {(bins ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} · {b.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  name,
  required,
  defaultValue,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
    </label>
  );
}
