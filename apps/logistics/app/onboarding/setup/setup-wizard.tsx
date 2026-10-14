"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/app/_components/brand-mark";
import { LagerConfigForm } from "@/app/admin/settings/lager-config-form";
import { SlipBrandingForm } from "@/app/admin/settings/slip-branding-form";
import { NewUserForm } from "@/app/admin/users/new-user-form";
import { listAdminJobsAction } from "@/app/admin/products/actions";
import type { SlipBrandingConfig } from "@/lib/slip/defaults";
import type { LagerConfigFormValue } from "@/app/admin/settings/lager-config-form";
import {
  completeOnboardingAction,
  markOnboardingProductsImportedAction,
  runOnboardingOrdersImportAction,
  saveOnboardingStepAction,
  startOnboardingProductSyncAction,
} from "../actions";

type OnboardingImportSnapshot = {
  productsDone: boolean;
  productCount: number;
  variantCount: number;
  openOrdersDone: boolean;
  openOrdersCount: number;
  historyDone: boolean;
  historyOrdersCount: number;
};

const STEPS = [
  { id: "welcome", label: "Willkommen" },
  { id: "import", label: "Daten importieren" },
  { id: "batches", label: "Chargen" },
  { id: "slip", label: "Lieferschein" },
  { id: "dhl", label: "DHL & Versand" },
  { id: "team", label: "Mitarbeiter" },
  { id: "done", label: "Fertig" },
] as const;

type ImportPhase = "idle" | "products" | "open_orders" | "history" | "done";

const IMPORT_STEP_COUNT = 3;

/** Share of the first import step each product-sync phase fills. */
const PRODUCT_PHASE_FRACTION: Record<string, number> = {
  starting: 0.12,
  locations: 0.35,
  catalog: 0.62,
  inventory: 0.82,
  applying_inventory: 0.94,
  done: 1,
};

const SYNC_PHASE_LABEL: Record<string, string> = {
  starting: "Start",
  locations: "Standorte",
  catalog: "Katalog",
  inventory: "Bestände laden",
  applying_inventory: "Bestände schreiben",
  done: "Fertig",
};

function importProgress(
  phase: ImportPhase,
  syncPhase: string,
): { pct: number; step: number; label: string } {
  if (phase === "done") return { pct: 100, step: 3, label: "Fertig" };
  if (phase === "history") {
    return { pct: 83, step: 3, label: "Kunden & Historie" };
  }
  if (phase === "open_orders") {
    return { pct: 50, step: 2, label: "Offene Aufträge" };
  }
  if (phase === "products") {
    const fraction = PRODUCT_PHASE_FRACTION[syncPhase] ?? 0.08;
    const sub = SYNC_PHASE_LABEL[syncPhase];
    return {
      pct: Math.round((fraction / IMPORT_STEP_COUNT) * 100),
      step: 1,
      label: sub ? `Standorte & Produkte · ${sub}` : "Standorte & Produkte",
    };
  }
  return { pct: 0, step: 0, label: "" };
}

const inputClass =
  "mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-brand-ink shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

const labelClass =
  "block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70";

export function SetupWizard({
  initialStep,
  initialImport,
  justInstalled,
  shopDomain,
  lagerConfig,
  slipBranding,
  qrPreview = null,
  userEmail,
}: {
  initialStep: number;
  initialImport: OnboardingImportSnapshot;
  justInstalled: boolean;
  shopDomain: string;
  lagerConfig: LagerConfigFormValue;
  slipBranding: SlipBrandingConfig;
  qrPreview?: string | null;
  userEmail: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [pending, startTransition] = useTransition();
  const [productsDone, setProductsDone] = useState(initialImport.productsDone);
  const [openOrdersDone, setOpenOrdersDone] = useState(
    initialImport.openOrdersDone,
  );
  const [historyDone, setHistoryDone] = useState(initialImport.historyDone);
  const [importPhase, setImportPhase] = useState<ImportPhase>(
    initialImport.historyDone ? "done" : "idle",
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [importStats, setImportStats] = useState({
    products: initialImport.productCount,
    variants: initialImport.variantCount,
    openOrders: initialImport.openOrdersCount,
    historyOrders: initialImport.historyOrdersCount,
  });
  const [syncPhase, setSyncPhase] = useState(
    initialImport.productsDone ? "done" : "",
  );

  const progressPct = Math.round(((step + 1) / STEPS.length) * 100);

  const goToStep = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(next, STEPS.length - 1));
      setStep(clamped);
      startTransition(async () => {
        await saveOnboardingStepAction(clamped);
      });
    },
    [startTransition],
  );

  async function runImport() {
    setImportError(null);

    if (!productsDone) {
      setImportPhase("products");

      const started = await startOnboardingProductSyncAction();
      if (started.ok && started.skipped) {
        setSyncPhase("done");
        setImportStats((s) => ({
          ...s,
          products: started.products,
          variants: started.variants,
        }));
        setProductsDone(true);
      } else {
        const runId = started.ok ? started.runId : "";
        if (!started.ok && started.error !== "sync_already_running") {
          setImportError(started.error);
          setImportPhase("idle");
          return;
        }

        let syncDone = false;
        let productCount = 0;
        let variantCount = 0;
        for (let i = 0; i < 300 && !syncDone; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const res = await listAdminJobsAction();
          if (!res.ok) continue;
          const job = res.jobs.find((j) => j.id === runId) ?? res.jobs[0];
          if (!job) continue;

          setSyncPhase(job.phase);
          productCount = job.productCount;
          variantCount = job.variantCount;
          setImportStats((s) => ({
            ...s,
            products: job.productCount,
            variants: job.variantCount,
          }));

          if (job.status === "COMPLETED") {
            syncDone = true;
            break;
          }
          if (job.status === "FAILED" || job.status === "CANCELLED") {
            setImportError(job.error ?? "Produkt-Sync fehlgeschlagen");
            return;
          }
        }

        if (!syncDone) {
          setImportError(
            "Produkt-Sync hat zu lange gedauert — bitte erneut versuchen.",
          );
          return;
        }

        await markOnboardingProductsImportedAction(productCount, variantCount);
        setProductsDone(true);
      }
    }

    if (!openOrdersDone) {
      setImportPhase("open_orders");
      const open = await runOnboardingOrdersImportAction("open");
      if (!open.ok) {
        setImportError(open.error);
        return;
      }
      setImportStats((s) => ({ ...s, openOrders: open.count }));
      setOpenOrdersDone(true);
    }

    if (!historyDone) {
      setImportPhase("history");
      const history = await runOnboardingOrdersImportAction("history");
      if (!history.ok) {
        setImportError(history.error);
        return;
      }
      setImportStats((s) => ({ ...s, historyOrders: history.count }));
      setHistoryDone(true);
    }

    setImportPhase("done");
  }

  function finishSetup() {
    startTransition(async () => {
      const res = await completeOnboardingAction();
      if (res.ok) {
        router.replace("/admin");
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      {/* Progress */}
      <div className="mb-10">
        <div className="flex items-center justify-between text-xs text-brand-navy/60">
          <span>
            Schritt {step + 1} von {STEPS.length}
          </span>
          <span className="font-semibold text-brand-navy">{progressPct}%</span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-brand-burgundy transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <ol className="mt-4 hidden gap-1 sm:flex">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={`flex-1 truncate rounded px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wide ${
                i === step
                  ? "bg-brand-navy text-white"
                  : i < step
                    ? "bg-brand-burgundy/15 text-brand-burgundy"
                    : "bg-zinc-100 text-brand-navy/40"
              }`}
            >
              {s.label}
            </li>
          ))}
        </ol>
      </div>

      {/* Step content */}
      <div className="flex flex-1 flex-col">
        {step === 0 ? (
          <WelcomeStep
            justInstalled={justInstalled}
            shopDomain={shopDomain}
            userEmail={userEmail}
            onNext={() => goToStep(1)}
          />
        ) : null}

        {step === 1 ? (
          <ImportStep
            phase={importPhase}
            syncPhase={syncPhase}
            error={importError}
            stats={importStats}
            pending={pending}
            resume={(productsDone || openOrdersDone) && !historyDone}
            doneStages={{
              products: productsDone,
              openOrders: openOrdersDone,
              history: historyDone,
            }}
            onStart={() => startTransition(() => void runImport())}
            onNext={() => goToStep(2)}
            onBack={() => goToStep(0)}
          />
        ) : null}

        {step === 2 ? (
          <ConfigStep
            title="Chargen & MHD"
            description="Steuert, ob Chargen beim Lieferschein-Druck zugeordnet werden. Du kannst das später unter Einstellungen → Chargen ändern."
            onBack={() => goToStep(1)}
            onNext={() => goToStep(3)}
          >
            <LagerConfigForm current={lagerConfig} />
          </ConfigStep>
        ) : null}

        {step === 3 ? (
          <ConfigStep
            title="Lieferschein-Branding"
            description="Deine Firmendaten erscheinen auf jedem gedruckten Lieferschein — Name, Adresse, Kontakt und Farben."
            onBack={() => goToStep(2)}
            onNext={() => goToStep(4)}
          >
            <SlipBrandingForm current={slipBranding} qrPreview={qrPreview} />
          </ConfigStep>
        ) : null}

        {step === 4 ? (
          <DhlStep onBack={() => goToStep(3)} onNext={() => goToStep(5)} />
        ) : null}

        {step === 5 ? (
          <TeamStep onBack={() => goToStep(4)} onNext={() => goToStep(6)} />
        ) : null}

        {step === 6 ? (
          <DoneStep pending={pending} onFinish={finishSetup} />
        ) : null}
      </div>
    </div>
  );
}

function WelcomeStep({
  justInstalled,
  shopDomain,
  userEmail,
  onNext,
}: {
  justInstalled: boolean;
  shopDomain: string;
  userEmail: string;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="card flex-1 p-8">
        <p className="eyebrow">Einrichtung</p>
        <h1 className="h-display mt-2 text-3xl text-brand-navy">
          Willkommen bei Shrymp Logistics
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-brand-navy/70">
          In den nächsten Minuten richten wir dein Lager ein: Shopify-Daten
          importieren, Chargen konfigurieren, Lieferschein-Branding setzen und
          optional DHL & Mitarbeiter einrichten.
        </p>

        {justInstalled ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Shopify erfolgreich verbunden ({shopDomain}).
          </div>
        ) : null}

        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
              Shop
            </dt>
            <dd className="mt-1 font-mono text-xs text-brand-navy">
              {shopDomain}
            </dd>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
              Admin
            </dt>
            <dd className="mt-1 text-xs text-brand-navy">{userEmail}</dd>
          </div>
        </dl>

        <ul className="mt-6 space-y-2 text-sm text-brand-navy/80">
          <li className="flex gap-2">
            <span className="text-brand-burgundy">→</span>
            Produkte, Standorte, Aufträge & Kunden aus Shopify laden
          </li>
          <li className="flex gap-2">
            <span className="text-brand-burgundy">→</span>
            Chargen-Tracking & Lieferschein-Daten konfigurieren
          </li>
          <li className="flex gap-2">
            <span className="text-brand-burgundy">→</span>
            DHL-Versand & Lager-Mitarbeiter einladen (optional)
          </li>
        </ul>
      </div>

      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onNext} className="btn-primary">
          Einrichtung starten
        </button>
      </div>
    </div>
  );
}

function ImportStep({
  phase,
  syncPhase,
  error,
  stats,
  pending,
  resume = false,
  doneStages = { products: false, openOrders: false, history: false },
  onStart,
  onNext,
  onBack,
}: {
  phase: ImportPhase;
  syncPhase: string;
  error: string | null;
  stats: {
    products: number;
    variants: number;
    openOrders: number;
    historyOrders: number;
  };
  pending: boolean;
  resume?: boolean;
  doneStages?: {
    products: boolean;
    openOrders: boolean;
    history: boolean;
  };
  onStart: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const progress = importProgress(phase, syncPhase);
  const running =
    !error &&
    (phase === "products" || phase === "open_orders" || phase === "history");
  const subSteps = [
    {
      label: "Standorte & Produkte",
      done:
        doneStages.products ||
        phase === "open_orders" ||
        phase === "history" ||
        phase === "done",
      active: phase === "products" && !error,
    },
    {
      label: "Offene Aufträge",
      done:
        doneStages.openOrders || phase === "history" || phase === "done",
      active: phase === "open_orders" && !error,
    },
    {
      label: "Kunden & Historie",
      done: doneStages.history || phase === "done",
      active: phase === "history" && !error,
    },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="card flex-1 p-8">
        <p className="eyebrow">Import</p>
        <h2 className="mt-2 text-xl font-semibold text-brand-navy">
          Shopify-Daten laden
        </h2>
        <p className="mt-2 text-sm text-brand-navy/70">
          Wir holen deine Produkte, Lagerstandorte, offenen Aufträge und
          Kundendaten aus Shopify. Den Import kannst du überspringen und
          später im Admin nachholen.
        </p>

        {phase !== "idle" ? (
          <div className="mt-6">
            <div className="flex items-center justify-between text-xs text-brand-navy/60">
              <span>
                Schritt {progress.step} von {IMPORT_STEP_COUNT}
                {progress.label ? ` · ${progress.label}` : ""}
              </span>
              <span className="font-semibold text-brand-navy">
                {progress.pct}%
              </span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200"
              role="progressbar"
              aria-valuenow={progress.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Import-Fortschritt"
            >
              <div
                className="h-full rounded-full bg-brand-burgundy transition-all duration-500 ease-out"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
          </div>
        ) : null}

        <ul className="mt-6 space-y-3">
          {subSteps.map((s) => (
            <li
              key={s.label}
              className={`flex items-center gap-3 rounded-md border px-4 py-3 text-sm ${
                s.done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : s.active
                    ? "border-brand-burgundy/30 bg-brand-burgundy-soft text-brand-navy"
                    : "border-zinc-200 bg-zinc-50 text-brand-navy/60"
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold">
                {s.done ? "✓" : s.active ? "…" : "○"}
              </span>
              <span className="font-medium">{s.label}</span>
              {s.active && phase === "products" && syncPhase && syncPhase !== "done" ? (
                <span className="ml-auto text-xs text-brand-navy/60">
                  {SYNC_PHASE_LABEL[syncPhase] ?? syncPhase}
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        {phase !== "idle" ? (
          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            <Stat label="Produkte" value={stats.products} />
            <Stat label="Varianten" value={stats.variants} />
            {phase === "history" || phase === "done" ? (
              <Stat label="Offene Aufträge" value={stats.openOrders} />
            ) : null}
            {phase === "done" ? (
              <Stat label="Historie importiert" value={stats.historyOrders} />
            ) : null}
          </dl>
        ) : null}

        {phase === "idle" && resume && !error ? (
          <p className="mt-4 text-sm text-brand-navy/70">
            Schon importierte Daten bleiben. Es werden nur die fehlenden
            Schritte geladen.
          </p>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-4 py-3 text-sm text-brand-burgundy-dark">
            {error}
          </div>
        ) : null}

        {phase === "idle" || error ? (
          <button
            type="button"
            onClick={onStart}
            disabled={pending || running}
            className="btn-primary mt-6"
          >
            {pending
              ? "Starte Import…"
              : error
                ? "Erneut versuchen"
                : resume
                  ? "Import fortsetzen"
                  : "Import starten"}
          </button>
        ) : null}

        {running ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-brand-navy/70">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-burgundy border-t-transparent" />
            Import läuft — bitte Fenster offen lassen.
          </p>
        ) : null}

        {phase === "done" ? (
          <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Import abgeschlossen. Deine Aufträge und Produkte sind bereit.
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="btn-ghost">
          Zurück
        </button>
        <div className="flex items-center gap-3">
          {phase !== "done" ? (
            <button type="button" onClick={onNext} className="btn-secondary">
              Import überspringen
            </button>
          ) : null}
          <button
            type="button"
            onClick={onNext}
            disabled={phase !== "done"}
            className="btn-primary disabled:opacity-40"
          >
            Weiter
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-4 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-lg font-semibold text-brand-navy">
        {value.toLocaleString("de-DE")}
      </dd>
    </div>
  );
}

function ConfigStep({
  title,
  description,
  children,
  onBack,
  onNext,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="card flex-1 p-8">
        <p className="eyebrow">Konfiguration</p>
        <h2 className="mt-2 text-xl font-semibold text-brand-navy">{title}</h2>
        <p className="mt-2 text-sm text-brand-navy/70">{description}</p>
        <div className="mt-6">{children}</div>
      </div>
      <div className="mt-6 flex justify-between">
        <button type="button" onClick={onBack} className="btn-ghost">
          Zurück
        </button>
        <button type="button" onClick={onNext} className="btn-primary">
          Weiter
        </button>
      </div>
    </div>
  );
}

function DhlStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const { saveDhlConfigAction } = await import(
        "@/app/admin/settings/dhl-config-actions"
      );
      const res = await saveDhlConfigAction(fd);
      if (res.ok) {
        router.refresh();
        onNext();
      }
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="card flex-1 p-8">
        <p className="eyebrow">Optional</p>
        <h2 className="mt-2 text-xl font-semibold text-brand-navy">
          DHL Versand & Rechnungsdaten
        </h2>
        <p className="mt-2 text-sm text-brand-navy/70">
          Für Versandlabels brauchst du deine DHL-Abrechnungsnummer und
          Absenderadresse. Du kannst das auch später unter Einstellungen → DHL
          einrichten.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <input
            type="hidden"
            name="profile"
            value="STANDARD_GRUPPENPROFIL"
          />
          <input type="hidden" name="default_weight_g" value="1000" />
          <input type="hidden" name="shipper_country" value="DEU" />
          <input type="hidden" name="sandbox" value="on" />

          <div>
            <label className={labelClass}>Abrechnungsnummer (14-stellig)</label>
            <input
              name="billing_number"
              required
              maxLength={14}
              minLength={14}
              pattern=".{14}"
              className={`${inputClass} font-mono`}
              placeholder="33333333330102"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Absender — Firma</label>
              <input
                name="shipper_name1"
                required
                maxLength={50}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Straße</label>
              <input
                name="shipper_addressStreet"
                required
                maxLength={50}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>PLZ</label>
              <input
                name="shipper_postalCode"
                required
                maxLength={10}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Ort</label>
              <input
                name="shipper_city"
                required
                maxLength={40}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={pending}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {pending ? "Speichern…" : "Speichern & weiter"}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 flex justify-between">
        <button type="button" onClick={onBack} className="btn-ghost">
          Zurück
        </button>
        <button type="button" onClick={onNext} className="btn-secondary">
          Später einrichten
        </button>
      </div>
    </div>
  );
}

function TeamStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="card flex-1 p-8">
        <p className="eyebrow">Optional</p>
        <h2 className="mt-2 text-xl font-semibold text-brand-navy">
          Mitarbeiter einladen
        </h2>
        <p className="mt-2 text-sm text-brand-navy/70">
          Lege Lager-Mitarbeiter mit E-Mail und Initial-Passwort an. Sie
          können sich sofort unter /login anmelden und mit dem Kommissionieren
          starten.
        </p>
        <div className="mt-6">
          <NewUserForm />
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <button type="button" onClick={onBack} className="btn-ghost">
          Zurück
        </button>
        <button type="button" onClick={onNext} className="btn-primary">
          Weiter
        </button>
      </div>
    </div>
  );
}

function DoneStep({
  pending,
  onFinish,
}: {
  pending: boolean;
  onFinish: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="card w-full max-w-lg p-10">
        <BrandMark variant="dark" />
        <h2 className="mt-6 text-2xl font-semibold text-brand-navy">
          Einrichtung abgeschlossen
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-brand-navy/70">
          Dein Lager ist eingerichtet. Du findest deine importierten Aufträge
          unter Admin → Aufträge und kannst direkt mit dem Kommissionieren
          starten.
        </p>
        <button
          type="button"
          onClick={onFinish}
          disabled={pending}
          className="btn-primary mt-8 w-full disabled:opacity-50"
        >
          {pending ? "Wird geöffnet…" : "Zum Admin-Bereich"}
        </button>
      </div>
    </div>
  );
}
