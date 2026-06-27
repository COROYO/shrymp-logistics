"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { clientAuth } from "@/lib/firebase/client";

const inputClass =
  "mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-brand-ink shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

const labelClass =
  "block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70";

export function RegisterForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    const payload = {
      email,
      password,
      displayName: String(fd.get("displayName") ?? "") || undefined,
      shopDomain: String(fd.get("shopDomain") ?? "") || undefined,
    };

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;

      if (!j?.ok) {
        const code = j?.error ?? "";
        setError(
          code === "invalid_shop_domain"
            ? "Ungültige Shop-Domain."
            : code === "email-already-exists" ||
                code.includes("email-already-exists")
              ? "Diese E-Mail ist bereits registriert."
              : code === "rate_limited"
                ? "Zu viele Versuche. Bitte später erneut versuchen."
                : code === "registration_failed"
                  ? "Registrierung fehlgeschlagen. Bitte später erneut versuchen."
                  : (code || `HTTP ${res.status}`),
        );
        return;
      }

      const cred = await signInWithEmailAndPassword(
        clientAuth(),
        email,
        password,
      );
      const idToken = await cred.user.getIdToken();
      const sessionRes = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!sessionRes.ok) {
        throw new Error("session_failed");
      }

      startTransition(() => {
        router.replace("/onboarding");
        router.refresh();
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
      <div>
        <label htmlFor="shopDomain" className={labelClass}>
          Shopify-Shop (optional)
        </label>
        <input
          id="shopDomain"
          name="shopDomain"
          type="text"
          placeholder="mein-shop.myshopify.com"
          className={inputClass}
        />
        <p className="mt-1.5 text-xs text-brand-navy/55">
          Kannst du auch gleich im nächsten Schritt verbinden.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="btn-primary w-full !py-3"
      >
        {pending ? "Registriere…" : "Konto anlegen"}
      </button>
    </form>
  );
}
