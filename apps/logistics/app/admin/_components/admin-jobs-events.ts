export const ADMIN_JOBS_REFRESH_EVENT = "admin-jobs-refresh";

export const ADMIN_JOBS_ERROR_EVENT = "admin-jobs-error";

export const ADMIN_JOBS_SUCCESS_EVENT = "admin-jobs-success";

/** @deprecated Use ADMIN_JOBS_REFRESH_EVENT */
export const PRODUCT_SYNC_STARTED_EVENT = ADMIN_JOBS_REFRESH_EVENT;

export type AdminJobNoticeDetail = {
  title?: string;
  message: string;
};

/** @deprecated Use AdminJobNoticeDetail */
export type AdminJobErrorDetail = AdminJobNoticeDetail;

function dispatchNotice(event: string, detail: AdminJobNoticeDetail): void {
  if (typeof window === "undefined" || !detail.message) return;
  window.dispatchEvent(
    new CustomEvent<AdminJobNoticeDetail>(event, { detail }),
  );
}

export function dispatchAdminJobError(detail: AdminJobNoticeDetail): void {
  dispatchNotice(ADMIN_JOBS_ERROR_EVENT, detail);
}

export function dispatchAdminJobSuccess(detail: AdminJobNoticeDetail): void {
  dispatchNotice(ADMIN_JOBS_SUCCESS_EVENT, detail);
}
