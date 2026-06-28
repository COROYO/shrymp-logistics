"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  cancelProductSyncRunAction,
  listAdminJobsAction,
} from "@/app/admin/products/actions";
import {
  ADMIN_JOBS_ERROR_EVENT,
  ADMIN_JOBS_REFRESH_EVENT,
  ADMIN_JOBS_SUCCESS_EVENT,
  type AdminJobNoticeDetail,
} from "./admin-jobs-events";

const PHASE_KEYS = [
  "starting",
  "locations",
  "catalog",
  "inventory",
  "applying_inventory",
  "done",
] as const;

const TRAY_AUTO_DISMISS_MS = 15_000;

type JobRow = {
  id: string;
  kind: "product_sync";
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  phase: string;
  productCount: number;
  variantCount: number;
  syncInventory: boolean;
  inventoryUpdated?: number;
  error?: string;
  cancelRequested?: boolean;
  finishedAtMs?: number;
};

type ClientNotice = {
  id: string;
  title: string;
  message: string;
  kind: "success" | "error";
  createdAt: number;
};

export function AdminJobsTray() {
  const t = useTranslations("adminJobs");
  const tSync = useTranslations("products.syncBanner");
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [notices, setNotices] = useState<ClientNotice[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const refreshedCompleted = useRef<Set<string>>(new Set());
  const noticeSeq = useRef(0);

  const pushNotice = useCallback(
    (kind: ClientNotice["kind"], title: string, message: string) => {
      noticeSeq.current += 1;
      setNotices((cur) => [
        ...cur,
        {
          id: `${kind}-${noticeSeq.current}`,
          title,
          message,
          kind,
          createdAt: Date.now(),
        },
      ]);
    },
    [],
  );

  const refreshJobs = useCallback(async () => {
    const res = await listAdminJobsAction();
    if (!res.ok) {
      setJobs([]);
      return;
    }

    setJobs(res.jobs);

    for (const job of res.jobs) {
      if (
        job.status === "COMPLETED" &&
        !refreshedCompleted.current.has(job.id)
      ) {
        refreshedCompleted.current.add(job.id);
        router.refresh();
      }
    }
  }, [router]);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  const hasRunning = jobs.some((j) => j.status === "RUNNING");
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => void refreshJobs(), 2000);
    return () => clearInterval(id);
  }, [hasRunning, refreshJobs]);

  useEffect(() => {
    function onRefresh() {
      void refreshJobs();
    }
    window.addEventListener(ADMIN_JOBS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ADMIN_JOBS_REFRESH_EVENT, onRefresh);
  }, [refreshJobs]);

  useEffect(() => {
    function onError(event: Event) {
      const detail = (event as CustomEvent<AdminJobNoticeDetail>).detail;
      if (!detail?.message) return;
      pushNotice("error", detail.title ?? t("error"), detail.message);
    }
    function onSuccess(event: Event) {
      const detail = (event as CustomEvent<AdminJobNoticeDetail>).detail;
      if (!detail?.message) return;
      pushNotice("success", detail.title ?? t("success"), detail.message);
    }
    window.addEventListener(ADMIN_JOBS_ERROR_EVENT, onError);
    window.addEventListener(ADMIN_JOBS_SUCCESS_EVENT, onSuccess);
    return () => {
      window.removeEventListener(ADMIN_JOBS_ERROR_EVENT, onError);
      window.removeEventListener(ADMIN_JOBS_SUCCESS_EVENT, onSuccess);
    };
  }, [pushNotice, t]);

  const visibleJobs = useMemo(
    () => jobs.filter((j) => !dismissed.has(j.id)),
    [jobs, dismissed],
  );
  const visibleNotices = useMemo(
    () => notices.filter((n) => !dismissed.has(n.id)),
    [notices, dismissed],
  );
  const hasContent = visibleJobs.length > 0 || visibleNotices.length > 0;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const job of jobs) {
      if (dismissed.has(job.id)) continue;
      if (job.status !== "COMPLETED" && job.status !== "CANCELLED") continue;
      const elapsed = job.finishedAtMs ? Date.now() - job.finishedAtMs : 0;
      const delay = Math.max(0, TRAY_AUTO_DISMISS_MS - elapsed);
      timers.push(
        setTimeout(() => {
          setDismissed((cur) => new Set(cur).add(job.id));
        }, delay),
      );
    }

    for (const notice of notices) {
      if (dismissed.has(notice.id)) continue;
      if (notice.kind !== "success") continue;
      const elapsed = Date.now() - notice.createdAt;
      const delay = Math.max(0, TRAY_AUTO_DISMISS_MS - elapsed);
      timers.push(
        setTimeout(() => {
          setDismissed((cur) => new Set(cur).add(notice.id));
        }, delay),
      );
    }

    return () => timers.forEach(clearTimeout);
  }, [jobs, notices, dismissed]);

  if (!hasContent) return null;

  function dismiss(id: string) {
    setDismissed((cur) => new Set(cur).add(id));
  }

  function cancelJob(job: JobRow) {
    startTransition(async () => {
      const res = await cancelProductSyncRunAction(
        job.id,
        job.cancelRequested === true,
      );
      if (!res.ok) {
        pushNotice("error", t("productSync"), res.error);
      }
      void refreshJobs();
    });
  }

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(100vw-2rem,20rem)] flex-col gap-2 print:hidden"
      aria-live="polite"
    >
      <div className="pointer-events-auto overflow-hidden rounded-lg border border-brand-navy-soft bg-brand-navy shadow-xl shadow-brand-navy/40">
        <div className="border-b border-white/10 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
            {t("title")}
          </p>
        </div>
        <ul className="max-h-[min(50vh,16rem)] divide-y divide-white/10 overflow-y-auto">
          {visibleJobs.map((job) =>
            job.status === "FAILED" ? (
              <li key={job.id} className="px-3 py-2.5">
                <NoticeRow
                  kind="error"
                  title={t("productSync")}
                  message={`${tSync("failed")}: ${job.error ?? tSync("unknownError")}`}
                  dismissLabel={t("dismiss")}
                  onDismiss={() => dismiss(job.id)}
                />
              </li>
            ) : (
              <li key={job.id} className="px-3 py-2.5">
                <JobCard
                  job={job}
                  pending={pending}
                  title={t("productSync")}
                  message={jobMessage(tSync, job)}
                  onCancel={() => cancelJob(job)}
                  onDismiss={() => dismiss(job.id)}
                  cancelLabel={t("cancelJob")}
                  dismissLabel={t("dismiss")}
                />
              </li>
            ),
          )}
          {visibleNotices.map((notice) => (
            <li key={notice.id} className="px-3 py-2.5">
              <NoticeRow
                kind={notice.kind}
                title={notice.title}
                message={notice.message}
                dismissLabel={t("dismiss")}
                onDismiss={() => dismiss(notice.id)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function jobMessage(
  t: ReturnType<typeof useTranslations<"products.syncBanner">>,
  job: JobRow,
): string {
  if (job.status === "RUNNING") {
    if (job.cancelRequested) {
      return t("stopping", {
        products: job.productCount,
        variants: job.variantCount,
      });
    }
    return t("running", {
      products: job.productCount,
      variants: job.variantCount,
      phase: phaseLabel(t, job.phase),
    });
  }
  if (job.status === "COMPLETED") {
    if (job.syncInventory && (job.inventoryUpdated ?? 0) > 0) {
      return t("completedWithInventory", {
        products: job.productCount,
        variants: job.variantCount,
        inventoryUpdated: job.inventoryUpdated ?? 0,
      });
    }
    return t("completed", {
      products: job.productCount,
      variants: job.variantCount,
    });
  }
  if (job.status === "CANCELLED") return t("cancelled");
  return `${t("failed")}: ${job.error ?? t("unknownError")}`;
}

function phaseLabel(
  t: ReturnType<typeof useTranslations<"products.syncBanner">>,
  phase: string,
): string {
  if (PHASE_KEYS.includes(phase as (typeof PHASE_KEYS)[number])) {
    return t(`phase.${phase as (typeof PHASE_KEYS)[number]}`);
  }
  return phase;
}

function NoticeRow({
  kind,
  title,
  message,
  onDismiss,
  dismissLabel,
}: {
  kind: "success" | "error";
  title: string;
  message: string;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  const dotColor = kind === "success" ? "bg-emerald-400" : "bg-rose-400";
  const textColor = kind === "success" ? "text-emerald-300" : "text-rose-300";

  return (
    <div className="flex items-start gap-2">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-white">{title}</p>
        <p className={`mt-0.5 text-[11px] leading-snug ${textColor}`}>
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        title={dismissLabel}
        className="shrink-0 rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function JobCard({
  job,
  pending,
  title,
  message,
  onCancel,
  onDismiss,
  cancelLabel,
  dismissLabel,
}: {
  job: JobRow;
  pending: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onDismiss: () => void;
  cancelLabel: string;
  dismissLabel: string;
}) {
  const isRunning = job.status === "RUNNING";
  const tone =
    job.status === "COMPLETED"
      ? "text-emerald-300"
      : job.status === "CANCELLED"
        ? "text-white/55"
        : "text-white/75";

  return (
    <div className="flex items-start gap-2">
      {isRunning ? (
        <Spinner />
      ) : job.status === "COMPLETED" || job.status === "CANCELLED" ? (
        <StatusDot status={job.status} />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-white">{title}</p>
        <p className={`mt-0.5 text-[11px] leading-snug ${tone}`}>{message}</p>
      </div>
      {isRunning ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          aria-label={cancelLabel}
          title={cancelLabel}
          className="shrink-0 rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <CloseIcon />
        </button>
      ) : (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          title={dismissLabel}
          className="shrink-0 rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

function StatusDot({
  status,
}: {
  status: "COMPLETED" | "CANCELLED";
}) {
  const color = status === "COMPLETED" ? "bg-emerald-400" : "bg-white/40";
  return (
    <span
      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`}
      aria-hidden
    />
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-white/80"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
