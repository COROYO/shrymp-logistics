"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function SetupForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      displayName: String(fd.get("displayName") ?? "") || undefined,
    };

    try {
      const res = await fetch("/api/setup/bootstrap-admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;

      if (!j) {
        setError(`HTTP ${res.status}: leere Antwort`);
        return;
      }
      if (!j.ok) {
        setError(j.error);
        return;
      }
      setDone(true);
      startTransition(() => {
        setTimeout(() => {
          router.replace("/login?setup=1");
          router.refresh();
        }, 500);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="displayName" className="block text-sm font-medium">
          Name (optional)
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          maxLength={80}
          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
        />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Passwort (min. 8 Zeichen)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
        />
      </div>

      {done ? (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Admin-Konto angelegt. Weiterleitung zum Login…
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending || done}
        className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Erstelle…" : "Admin anlegen"}
      </button>
    </form>
  );
}
