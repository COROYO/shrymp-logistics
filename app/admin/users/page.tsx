import { getSessionUser } from "@/lib/auth/session";
import { listUsers } from "@/server/users/management";
import { NewUserForm } from "./new-user-form";
import { UserRow } from "./user-row";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getSessionUser();
  const users = await listUsers();
  const myUid = me?.uid ?? "";

  const adminCount = users.filter(
    (u) => !u.disabled && u.role === "ADMIN",
  ).length;
  const lagerCount = users.filter(
    (u) => !u.disabled && u.role === "LAGER",
  ).length;
  const disabledCount = users.filter((u) => u.disabled).length;
  const noRoleCount = users.filter((u) => !u.role).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Benutzer</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Mitarbeiter:innen anlegen und Rollen verwalten. Nur Admins können
          hier ändern. Du selbst (<span className="font-mono">{me?.email}</span>
          ) kannst dich nicht versehentlich aussperren.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-4 text-sm">
        <Stat label="Admins (aktiv)" value={adminCount} />
        <Stat label="Lager (aktiv)" value={lagerCount} />
        <Stat label="Deaktiviert" value={disabledCount} />
        <Stat
          label="Ohne Rolle"
          value={noRoleCount}
          tone={noRoleCount > 0 ? "warn" : undefined}
        />
      </dl>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Neue:n Mitarbeiter:in anlegen</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Email + Initial-Passwort (min. 8 Zeichen). Die Person sollte beim
          ersten Login das Passwort ändern (Self-Service kommt später —
          aktuell musst du als Admin per &quot;Passwort zurücksetzen&quot;
          ein neues setzen).
        </p>
        <div className="mt-4">
          <NewUserForm />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-6 py-3">
          <h2 className="text-sm font-semibold">
            Alle Benutzer ({users.length})
          </h2>
        </div>
        {users.length === 0 ? (
          <p className="px-6 py-6 text-sm text-zinc-500">Keine Benutzer.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-6 py-2">Name / Email</th>
                <th className="px-6 py-2">Rolle</th>
                <th className="px-6 py-2">Status</th>
                <th className="px-6 py-2">Erstellt</th>
                <th className="px-6 py-2">Letzter Login</th>
                <th className="px-6 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {users.map((u) => (
                <UserRow key={u.uid} user={u} isMe={u.uid === myUid} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warn";
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd
        className={`mt-1 text-lg font-semibold ${
          tone === "warn" ? "text-amber-700" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
