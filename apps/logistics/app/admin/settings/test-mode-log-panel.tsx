export type TestModeLogRow = {
  id: string;
  mutation: string;
  summary: string;
  createdAtMs: number | null;
};

export function TestModeLogPanel({ rows }: { rows: TestModeLogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-brand-navy/60">
        Noch keine geplanten Shopify-Änderungen protokolliert.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-50 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
          <tr>
            <th className="px-3 py-2">Zeit</th>
            <th className="px-3 py-2">Operation</th>
            <th className="px-3 py-2">Beschreibung</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <tr key={row.id} className="text-brand-ink">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-brand-navy/70">
                {row.createdAtMs
                  ? new Date(row.createdAtMs).toLocaleString("de-DE")
                  : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                {row.mutation}
              </td>
              <td className="px-3 py-2">{row.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
