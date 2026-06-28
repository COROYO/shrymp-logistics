"use client";
import { useState, useTransition } from "react";
import type { UserListEntry } from "@/server/users/management";
import {
  deleteUserAction,
  resetUserPasswordAction,
  setUserDisabledAction,
  setUserRoleAction,
} from "./actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function UserRow({
  user,
  isMe,
}: {
  user: UserListEntry;
  isMe: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [pwModalOpen, setPwModalOpen] = useState(false);

  const createdShort = user.created_at_iso
    ? new Date(user.created_at_iso).toLocaleDateString("de-DE")
    : "—";
  const lastSignInShort = user.last_sign_in_iso
    ? new Date(user.last_sign_in_iso).toLocaleString("de-DE", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "nie";

  function run(
    successMessage: string,
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) {
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        dispatchAdminJobSuccess({ title: "Benutzer", message: successMessage });
      } else {
        dispatchAdminJobError({ title: "Benutzer", message: res.error });
        setErr(res.error);
      }
    });
  }

  function toggleRole() {
    const next = user.role === "ADMIN" ? "LAGER" : "ADMIN";
    if (
      !confirm(
        next === "ADMIN"
          ? `${user.email} zum ADMIN befördern?`
          : `${user.email} auf LAGER zurückstufen?`,
      )
    )
      return;
    run(
      next === "ADMIN"
        ? `${user.email} ist jetzt ADMIN.`
        : `${user.email} ist jetzt LAGER.`,
      () => setUserRoleAction(user.uid, next),
    );
  }

  function toggleDisabled() {
    const next = !user.disabled;
    if (
      !confirm(
        next
          ? `${user.email} deaktivieren? Login wird sofort gesperrt.`
          : `${user.email} reaktivieren?`,
      )
    )
      return;
    run(
      next
        ? `${user.email} deaktiviert.`
        : `${user.email} reaktiviert.`,
      () => setUserDisabledAction(user.uid, next),
    );
  }

  function handleDelete() {
    if (
      !confirm(
        `${user.email} ENDGÜLTIG löschen? Auth-User + Firestore-Doc weg.`,
      )
    )
      return;
    run(`${user.email} gelöscht.`, () => deleteUserAction(user.uid));
  }

  return (
    <>
      <tr className={user.disabled ? "bg-zinc-50/60 text-brand-navy/50" : undefined}>
        <td>
          <div className="font-semibold text-brand-navy">
            {user.display_name ?? user.email ?? user.uid}
            {isMe ? (
              <span className="chip chip-soft ml-2 !px-1.5 !py-0">du</span>
            ) : null}
          </div>
          {user.email && user.display_name ? (
            <div className="font-mono text-xs text-brand-navy/60">
              {user.email}
            </div>
          ) : null}
          {!user.has_mirror ? (
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              kein Firestore-Mirror — sync re-trigger empfohlen
            </div>
          ) : null}
        </td>
        <td>
          {user.role ? (
            <span
              className={
                user.role === "ADMIN" ? "chip chip-navy" : "chip chip-emerald"
              }
            >
              {user.role}
            </span>
          ) : (
            <span className="chip chip-amber">— keine —</span>
          )}
        </td>
        <td>
          <span
            className={user.disabled ? "chip chip-soft" : "chip chip-emerald"}
          >
            {user.disabled ? "deaktiviert" : "aktiv"}
          </span>
        </td>
        <td className="text-xs text-brand-navy/60">{createdShort}</td>
        <td className="text-xs text-brand-navy/60">{lastSignInShort}</td>
        <td className="whitespace-nowrap text-right">
          <div className="inline-flex gap-4 text-[11px] font-semibold uppercase tracking-[0.1em]">
            <button
              type="button"
              onClick={toggleRole}
              disabled={pending || isMe}
              className="text-brand-navy/70 transition hover:text-brand-burgundy disabled:opacity-30"
              title={
                isMe
                  ? "Du kannst deine eigene Rolle nicht ändern"
                  : "Rolle wechseln"
              }
            >
              {user.role === "ADMIN" ? "↓ Lager" : "↑ Admin"}
            </button>
            <button
              type="button"
              onClick={() => setPwModalOpen(true)}
              disabled={pending}
              className="text-brand-navy/70 transition hover:text-brand-burgundy disabled:opacity-30"
            >
              Passwort
            </button>
            <button
              type="button"
              onClick={toggleDisabled}
              disabled={pending || isMe}
              className="text-brand-navy/70 transition hover:text-brand-burgundy disabled:opacity-30"
              title={
                isMe
                  ? "Du kannst dich nicht selbst deaktivieren"
                  : user.disabled
                    ? "Reaktivieren"
                    : "Deaktivieren"
              }
            >
              {user.disabled ? "Aktivieren" : "Deaktivieren"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending || isMe}
              className="text-brand-burgundy transition hover:text-brand-burgundy-dark disabled:opacity-30"
            >
              Löschen
            </button>
          </div>
          {err ? (
            <div className="mt-1 text-[10px] font-semibold text-brand-burgundy">
              {err}
            </div>
          ) : null}
        </td>
      </tr>
      {pwModalOpen ? (
        <ResetPasswordRow
          uid={user.uid}
          email={user.email ?? user.uid}
          onClose={() => setPwModalOpen(false)}
        />
      ) : null}
    </>
  );
}

function ResetPasswordRow({
  uid,
  email,
  onClose,
}: {
  uid: string;
  email: string;
  onClose: () => void;
}) {
  const [pw, setPw] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleSave() {
    setErr(null);
    startTransition(async () => {
      const r = await resetUserPasswordAction(uid, pw);
      if (r.ok) {
        dispatchAdminJobSuccess({
          title: "Benutzer",
          message: `Passwort für ${email} gesetzt. Bitte dem Mitarbeiter mitteilen.`,
        });
        onClose();
      } else {
        dispatchAdminJobError({ title: "Benutzer", message: r.error });
        setErr(r.error);
      }
    });
  }

  return (
    <tr className="bg-amber-50/60">
      <td colSpan={6} className="px-6 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70">
              Neues Passwort für {email}
            </label>
            <input
              type="text"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="min. 8 Zeichen"
              className="mt-1.5 w-72 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            />
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || pw.length < 8}
            className="btn-primary"
          >
            {pending ? "…" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70 hover:text-brand-burgundy"
          >
            Abbrechen
          </button>
          {err ? (
            <span className="text-xs font-semibold text-brand-burgundy">
              {err}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
