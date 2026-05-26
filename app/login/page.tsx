import Link from "next/link";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getSessionUser } from "@/lib/auth/session";
import { hasAnyAdmin } from "@/lib/auth/bootstrap";
import { ServerConfigError } from "@/app/_components/server-config-error";
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
  if (!adminExists) redirect("/setup");

  const user = await getSessionUser();
  const { next, error, setup } = await searchParams;
  if (user) {
    redirect(next ?? (user.role === "ADMIN" ? "/admin" : "/lager"));
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Monolith Lager
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Bitte mit deinem Mitarbeiter-Konto anmelden.
          </p>
        </div>
        {setup === "1" ? (
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Admin-Konto angelegt. Du kannst dich jetzt einloggen.
          </div>
        ) : null}
        {error === "no_role" ? (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Dein Konto hat noch keine Rolle. Bitte beim Admin melden.
          </div>
        ) : null}
        <LoginForm nextPath={next ?? null} />
        <p className="text-xs text-zinc-400">
          Passwort vergessen?{" "}
          <Link
            href="/admin/users"
            className="underline hover:text-zinc-600"
          >
            Beim Admin melden
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
