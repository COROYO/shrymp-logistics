"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import { refreshOrderAction } from "./actions";

export function RefreshOrderButton({
  orderId,
  orderName,
}: {
  orderId: string;
  orderName: string;
}) {
  const t = useTranslations("orderDetail.sync");
  const router = useRouter();
  const [pending, start] = useTransition();

  function handle() {
    start(async () => {
      const res = await refreshOrderAction(orderId);
      if (res.ok) {
        dispatchAdminJobSuccess({ title: orderName, message: t("success") });
        router.refresh();
        return;
      }
      dispatchAdminJobError({
        title: orderName,
        message: res.error === "missing" ? t("missing") : t("error"),
      });
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className="btn-ghost"
    >
      {pending ? t("pending") : t("label")}
    </button>
  );
}
