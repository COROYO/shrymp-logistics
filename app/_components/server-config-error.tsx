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
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-xl space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-amber-900">{title}</h1>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-white p-3 font-mono text-xs text-zinc-800">
          {error}
        </pre>
        {hint ? (
          <p className="text-sm text-amber-900 whitespace-pre-line">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
