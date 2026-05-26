import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { hasAnyAdmin } from "@/lib/auth/bootstrap";
import { ServerConfigError } from "@/app/_components/server-config-error";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

const FIREBASE_HINT = `Wahrscheinlichste Ursache: das Firebase Admin SDK hat lokal keine Credentials.
Lokal fixen:
  • Entweder \`gcloud auth application-default login\`
  • Oder \`FIREBASE_SERVICE_ACCOUNT_JSON\` aus der Firebase Console kopieren
Außerdem in der Firebase Console: Authentication → Sign-in method → Email/Password aktivieren.`;

export default async function SetupPage() {
  let adminExists: boolean;
  try {
    adminExists = await hasAnyAdmin();
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return (
      <ServerConfigError
        title="Setup nicht möglich"
        error={e instanceof Error ? e.message : String(e)}
        hint={FIREBASE_HINT}
      />
    );
  }
  if (adminExists) redirect("/login");

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Monolith Lager
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Ersteinrichtung. Lege jetzt das erste Admin-Konto an. Spätere
            Mitarbeiter:innen werden aus der App heraus eingeladen.
          </p>
        </div>
        <SetupForm />
      </div>
    </div>
  );
}
