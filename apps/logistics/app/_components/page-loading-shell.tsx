import { StatSkeleton, TableSkeleton } from "./table-skeleton";

/** Shared skeleton while a route segment's server content streams in. */
export function PageLoadingShell({
  stats = 3,
  rows = 10,
  cols = 5,
}: {
  stats?: number;
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="space-y-8">
      <div className="animate-pulse">
        <div className="h-3 w-24 rounded bg-zinc-200" />
        <div className="mt-3 h-8 w-64 rounded bg-zinc-200" />
        <div className="mt-2 h-4 w-full max-w-2xl rounded bg-zinc-200" />
      </div>
      <StatSkeleton count={stats} />
      <div className="card overflow-hidden">
        <TableSkeleton rows={rows} cols={cols} />
      </div>
    </div>
  );
}
