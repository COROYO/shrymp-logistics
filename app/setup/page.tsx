import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { hasAnyAdmin } from "@/lib/auth/bootstrap";
import { ServerConfigError } from "@/app/_components/server-config-error";
import { BrandMark } from "@/app/_components/brand-mark";
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
            <p className="eyebrow">Setup</p>
            <h1 className="h-display mt-1 text-2xl">Ersteinrichtung</h1>
            <p className="mt-1 text-sm text-brand-navy/60">
              Lege jetzt das erste Admin-Konto an. Spätere Mitarbeiter:innen
              werden aus der App heraus eingeladen.
            </p>
          </div>
        </div>
        <SetupForm />
      </div>
    </div>
  );
}
