export function TableSkeleton({
  rows = 6,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="animate-pulse divide-y divide-zinc-100">
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 px-4 py-3"
          style={{ opacity: 1 - r * 0.06 }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <div
              key={c}
              className="h-3 rounded bg-zinc-200"
              style={{ flex: c === 0 ? 2 : 1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatSkeleton({ count = 3 }: { count?: number }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card animate-pulse p-5">
          <div className="h-3 w-24 rounded bg-zinc-200" />
          <div className="mt-3 h-8 w-16 rounded bg-zinc-200" />
        </div>
      ))}
    </dl>
  );
}
