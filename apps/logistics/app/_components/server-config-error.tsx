/**
 * Friendly fallback UI for server-side init failures (typically Firebase Admin
 * SDK credentials missing in local dev).
 */
export function ServerConfigError({
  title,
  error,
  hint,
}: {
  title: string;
  error: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-xl space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-8 shadow-md">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
          Konfiguration fehlt
        </p>
        <h1 className="h-display text-xl text-amber-900">{title}</h1>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-amber-200 bg-white p-3 font-mono text-xs text-brand-navy">
          {error}
        </pre>
        {hint ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-amber-900">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
