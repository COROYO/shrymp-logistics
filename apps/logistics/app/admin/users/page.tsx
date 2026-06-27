import { getSessionUser } from "@/lib/auth/session";
import { listAccessibleShopIds } from "@/lib/auth/tenant";
import { listUsersForShops } from "@/server/users/management";
import { NewUserForm } from "./new-user-form";
import { UserRow } from "./user-row";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getSessionUser();
  if (!me) return null;
  const shopIds = await listAccessibleShopIds(me);
  const users = await listUsersForShops(shopIds, me.uid);
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
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Team</p>
        <h1 className="h-display mt-1 text-3xl">Benutzer</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
          Mitarbeiter:innen anlegen und Rollen verwalten. Nur Admins können
          hier ändern. Du selbst (
          <span className="font-mono">{me?.email}</span>) kannst dich nicht
          versehentlich aussperren.
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

      <section className="card p-6">
        <p className="eyebrow">Neuer Account</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Mitarbeiter:in anlegen
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Email + Initial-Passwort (min. 8 Zeichen). Die Person sollte beim
          ersten Login das Passwort ändern (Self-Service kommt später —
          aktuell musst du als Admin per &quot;Passwort zurücksetzen&quot; ein
          neues setzen).
        </p>
        <div className="mt-5">
          <NewUserForm />
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-zinc-200 px-6 py-4">
          <p className="eyebrow">Alle Benutzer</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {users.length} Account{users.length === 1 ? "" : "s"}
          </h2>
        </div>
        {users.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-brand-navy/60">
            Keine Benutzer.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-brand">
              <thead>
                <tr>
                  <th>Name / Email</th>
                  <th>Rolle</th>
                  <th>Status</th>
                  <th>Erstellt</th>
                  <th>Letzter Login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.uid} user={u} isMe={u.uid === myUid} />
                ))}
              </tbody>
            </table>
          </div>
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
    <div className="card p-5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </dt>
      <dd
        className={`mt-1.5 text-2xl font-bold tabular-nums ${
          tone === "warn" ? "text-amber-700" : "text-brand-navy"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
