"use client";
import { useActionState, useEffect, useRef } from "react";
import { createUserAction, type CreateUserActionState } from "./actions";

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
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium">Email</label>
          <input
            type="email"
            name="email"
            required
            autoComplete="off"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium">
            Name (optional)
          </label>
          <input
            type="text"
            name="displayName"
            maxLength={80}
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium">
            Initial-Passwort (min. 8 Zeichen)
          </label>
          <input
            type="text"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium">Rolle</label>
          <select
            name="role"
            required
            defaultValue="LAGER"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="LAGER">LAGER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Lege an…" : "Mitarbeiter:in anlegen"}
        </button>
        {state?.ok ? (
          <span className="text-sm text-emerald-700">
            Angelegt (uid {state.uid.slice(0, 8)}…). Initial-Passwort dem
            Mitarbeiter mitteilen.
          </span>
        ) : null}
        {state && !state.ok ? (
          <span className="text-sm text-red-700">Fehler: {state.error}</span>
        ) : null}
      </div>
    </form>
  );
}
