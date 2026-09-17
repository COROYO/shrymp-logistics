"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePriorityTagsAction } from "./priority-tags-actions";
import { formatPriorityTagsInput } from "@/lib/lager/priority-tags";
import { DEFAULT_PRIORITY_TAGS } from "@/lib/lager/defaults";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function PriorityTagsForm({
  current,
}: {
  current: { priority_tags: string[] };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(
    formatPriorityTagsInput(current.priority_tags),
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await savePriorityTagsAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Priorität",
          message: "Prioritäts-Tags gespeichert.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({
          title: "Priorität",
          message: `${res.error}${
            res.details ? ` — ${JSON.stringify(res.details)}` : ""
          }`,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="priority_tags"
          className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60"
        >
          Prioritäts-Tags
        </label>
        <p className="mt-1 text-xs text-brand-navy/70">
          Shopify-Bestell-Tags, die in der Allocation zuerst bedient werden und
          in der Pick-Queue oben stehen. Mehrere Tags kommagetrennt — z.&nbsp;B.{" "}
          <span className="font-mono">EXPRESS_DHL, PRIO</span>. Standard:{" "}
          <span className="font-mono">
            {DEFAULT_PRIORITY_TAGS.join(", ")}
          </span>
          .
        </p>
        <input
          id="priority_tags"
          type="text"
          name="priority_tags"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="EXPRESS_DHL, PRIO"
          autoComplete="off"
          className="mt-2 w-full max-w-lg rounded-md border border-zinc-300 px-3 py-2 text-sm font-mono"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="btn-primary text-sm disabled:opacity-50"
      >
        {pending ? "Speichern…" : "Speichern"}
      </button>
    </form>
  );
}
