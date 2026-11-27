import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { merchantNeedsShopifyConnect } from "@/lib/auth/merchant";
import { BrandMark } from "@/app/_components/brand-mark";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) {
    if (user.role === "ADMIN" && (await merchantNeedsShopifyConnect(user))) {
      redirect("/onboarding");
    }
    redirect(user.role === "ADMIN" ? "/admin" : "/lager");
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-brand-ink/8 bg-white p-8 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="flex flex-col items-start gap-6">
          <BrandMark variant="dark" />
          <div>
            <p className="eyebrow">Registrierung</p>
            <h1 className="h-display mt-1 text-2xl">Shop anlegen</h1>
            <p className="mt-1 text-sm text-brand-navy/60">
              Erstelle dein Konto und verbinde danach deinen Shopify-Shop mit
              einem Klick.
            </p>
          </div>
        </div>

        <RegisterForm />

        <p className="text-center text-sm text-brand-navy/60">
          Schon ein Konto?{" "}
          <Link
            href="/login"
            className="font-medium text-brand-burgundy underline-offset-2 hover:underline"
          >
            Anmelden
          </Link>
        </p>
      </div>
    </div>
  );
}
