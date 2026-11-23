"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function OrdersSearch({
  initialQuery,
  placeholder,
}: {
  initialQuery: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [, startTransition] = useTransition();
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setValue(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const q = value.trim();
    if (q === initialQuery) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const current = (params.get("q") ?? "").trim();
      if (q === current) return;
      if (q) params.set("q", q);
      else params.delete("q");
      const href = params.size > 0 ? `/admin/orders?${params}` : "/admin/orders";
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [value, initialQuery, router]);

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
      }}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 sm:max-w-md"
    />
  );
}
