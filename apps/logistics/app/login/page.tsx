import Link from "next/link";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getSessionUser } from "@/lib/auth/session";
import { hasAnyAdmin } from "@/lib/auth/bootstrap";
import { safeNextPath } from "@/lib/safe-redirect";
import { ServerConfigError } from "@/app/_components/server-config-error";
import { BrandMark } from "@/app/_components/brand-mark";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; setup?: string }>;
}) {
  let adminExists: boolean;
  try {
    adminExists = await hasAnyAdmin();
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return (
      <ServerConfigError
        title="Login nicht möglich"
        error={e instanceof Error ? e.message : String(e)}
        hint="Server-seitige Firebase-Auth fehlt: setze FIREBASE_SERVICE_ACCOUNT_JSON oder `gcloud auth application-default login`."
      />
    );
  }
  if (!adminExists) redirect("/register");

  const user = await getSessionUser();
  const { next, error, setup } = await searchParams;
  const safeNext = next ? safeNextPath(next, "") || null : null;
  if (user) {
    redirect(safeNext ?? (user.role === "ADMIN" ? "/admin" : "/lager"));
  }

  return (
    <div className="relative flex flex-1 items-center justify-center px-4 py-16">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-cream via-brand-cream to-brand-stone"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-brand-navy"
      />

      <div className="w-full max-w-md space-y-8 rounded-2xl border border-zinc-200 bg-white p-10 shadow-xl shadow-brand-navy/5">
        <div className="flex flex-col items-start gap-6">
          <BrandMark variant="dark" />
          <div>
            <p className="eyebrow">Login</p>
            <h1 className="h-display mt-1 text-2xl">Willkommen zurück</h1>
            <p className="mt-1 text-sm text-brand-navy/60">
              Bitte mit deinem Mitarbeiter-Konto anmelden.
            </p>
          </div>
        </div>

        {setup === "1" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Admin-Konto angelegt. Du kannst dich jetzt einloggen.
          </div>
        ) : null}
        {error === "no_role" ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Dein Konto hat noch keine Rolle. Bitte beim Admin melden.
          </div>
        ) : null}

        <LoginForm nextPath={safeNext} />

        <p className="text-center text-sm text-brand-navy/60">
          Noch kein Konto?{" "}
          <Link
            href="/register"
            className="font-semibold text-brand-burgundy underline-offset-2 hover:underline"
          >
            Registrieren
          </Link>
        </p>

        <p className="text-xs text-brand-navy/50">
          Passwort vergessen?{" "}
          <Link
            href="/admin/users"
            className="font-semibold text-brand-burgundy underline-offset-2 hover:underline"
          >
            Beim Admin melden
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
