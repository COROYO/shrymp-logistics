"use client";
import { useActionState, useEffect, useRef } from "react";
import { createUserAction, type CreateUserActionState } from "./actions";

const inputClass =
  "mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-brand-ink shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

const labelClass =
  "block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70";

export function NewUserForm() {
  const [state, formAction, pending] = useActionState<
    CreateUserActionState,
    FormData
  >(createUserAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && !pending) formRef.current?.reset();
  }, [state, pending]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Email</label>
          <input
            type="email"
            name="email"
            required
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Name (optional)</label>
          <input
            type="text"
            name="displayName"
            maxLength={80}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            Initial-Passwort (min. 8 Zeichen)
          </label>
          <input
            type="text"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={`${inputClass} font-mono`}
          />
        </div>
        <div>
          <label className={labelClass}>Rolle</label>
          <select
            name="role"
            required
            defaultValue="LAGER"
            className={inputClass}
          >
            <option value="LAGER">LAGER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Lege an…" : "Mitarbeiter:in anlegen"}
        </button>
        {state?.ok ? (
          <span className="text-sm text-emerald-700">
            Angelegt (uid {state.uid.slice(0, 8)}…). Initial-Passwort dem
            Mitarbeiter mitteilen.
          </span>
        ) : null}
        {state && !state.ok ? (
          <span className="text-sm text-brand-burgundy-dark">
            Fehler: {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
