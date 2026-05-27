"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const inputClass =
  "mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-brand-ink shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

const labelClass =
  "block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70";

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
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="displayName" className={labelClass}>
          Name (optional)
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          maxLength={80}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="password" className={labelClass}>
          Passwort (min. 8 Zeichen)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      {done ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Admin-Konto angelegt. Weiterleitung zum Login…
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending || done}
        className="btn-primary w-full !py-3"
      >
        {pending ? "Erstelle…" : "Admin anlegen"}
      </button>
    </form>
  );
}
