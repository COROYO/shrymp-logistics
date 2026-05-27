"use client";
import { useState, useTransition } from "react";
import type { UserListEntry } from "@/server/users/management";
import {
  deleteUserAction,
  resetUserPasswordAction,
  setUserDisabledAction,
  setUserRoleAction,
} from "./actions";

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

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setErr(res.error);
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
    run(() => setUserRoleAction(user.uid, next));
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
    run(() => setUserDisabledAction(user.uid, next));
  }

  function handleDelete() {
    if (
      !confirm(
        `${user.email} ENDGÜLTIG löschen? Auth-User + Firestore-Doc weg.`,
      )
    )
      return;
    run(() => deleteUserAction(user.uid));
  }

  return (
    <>
      <tr className={user.disabled ? "bg-zinc-50/60 text-zinc-500" : undefined}>
        <td className="px-6 py-2">
          <div className="font-medium">
            {user.display_name ?? user.email ?? user.uid}
            {isMe ? (
              <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-700">
                du
              </span>
            ) : null}
          </div>
          {user.email && user.display_name ? (
            <div className="text-xs text-zinc-500 font-mono">{user.email}</div>
          ) : null}
          {!user.has_mirror ? (
            <div className="text-[10px] text-amber-700">
              kein Firestore-Mirror — sync re-trigger empfohlen
            </div>
          ) : null}
        </td>
        <td className="px-6 py-2">
          {user.role ? (
            <span
              className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
                user.role === "ADMIN"
                  ? "bg-zinc-900 text-white"
                  : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {user.role}
            </span>
          ) : (
            <span className="text-amber-700 text-xs">— keine —</span>
          )}
        </td>
        <td className="px-6 py-2">
          <span
            className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
              user.disabled
                ? "bg-zinc-200 text-zinc-700"
                : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {user.disabled ? "deaktiviert" : "aktiv"}
          </span>
        </td>
        <td className="px-6 py-2 text-xs text-zinc-500">{createdShort}</td>
        <td className="px-6 py-2 text-xs text-zinc-500">{lastSignInShort}</td>
        <td className="px-6 py-2 text-right whitespace-nowrap">
          <div className="inline-flex gap-3 text-xs">
            <button
              type="button"
              onClick={toggleRole}
              disabled={pending || isMe}
              className="text-zinc-700 hover:underline disabled:opacity-30"
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
              className="text-zinc-700 hover:underline disabled:opacity-30"
            >
              Passwort
            </button>
            <button
              type="button"
              onClick={toggleDisabled}
              disabled={pending || isMe}
              className="text-zinc-700 hover:underline disabled:opacity-30"
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
              className="text-red-700 hover:underline disabled:opacity-30"
            >
              Löschen
            </button>
          </div>
          {err ? <div className="text-[10px] text-red-700 mt-1">{err}</div> : null}
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
  const [done, setDone] = useState(false);

  function handleSave() {
    setErr(null);
    startTransition(async () => {
      const r = await resetUserPasswordAction(uid, pw);
      if (r.ok) {
        setDone(true);
      } else setErr(r.error);
    });
  }

  return (
    <tr className="bg-amber-50/60">
      <td colSpan={6} className="px-6 py-3">
        {done ? (
          <div className="flex items-center gap-3 text-sm text-emerald-800">
            ✓ Passwort für <strong>{email}</strong> gesetzt. Bitte dem
            Mitarbeiter mitteilen.
            <button
              type="button"
              onClick={() => {
                setDone(false);
                onClose();
              }}
              className="text-xs underline text-zinc-700"
            >
              Schließen
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium">
                Neues Passwort für {email}
              </label>
              <input
                type="text"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="min. 8 Zeichen"
                className="mt-1 w-72 rounded-md border border-zinc-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={pending || pw.length < 8}
              className="rounded bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {pending ? "…" : "Speichern"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="text-xs text-zinc-700 hover:underline"
            >
              Abbrechen
            </button>
            {err ? (
              <span className="text-xs text-red-700">{err}</span>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}
