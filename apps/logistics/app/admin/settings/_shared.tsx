export function DefItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-brand-ink">{children}</dd>
    </div>
  );
}

export function Badge({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "chip chip-emerald" : "chip chip-amber"}>
      {ok ? "OK" : "fehlt"}
    </span>
  );
}

export function getEnvHealth() {
  // Dynamic reads — App Hosting secrets are runtime-only (see lib/runtime-env.ts).
  const env = (name: string) => process.env[name];
  return {
    apiKey: !!env("SHOPIFY_API_KEY"),
    apiSecret: !!env("SHOPIFY_API_SECRET"),
    apiVersion: process.env.SHOPIFY_API_VERSION ?? null,
    allocationQueue: !!process.env.ALLOCATION_QUEUE,
    allocationTargetUrl: process.env.ALLOCATION_TARGET_URL ?? null,
    appUrl: process.env.APP_BASE_URL ?? null,
  };
}
