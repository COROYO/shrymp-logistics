import type { Metadata } from "next";
import { SiteFooter } from "@/app/_components/site-footer";
import { SiteHeader } from "@/app/_components/site-header";

type LegalPageShellProps = {
  title: string;
  children: React.ReactNode;
};

export function LegalPageShell({ title, children }: LegalPageShellProps) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="pt-16">
        <article className="section-pad">
          <div className="container-narrow legal-prose mx-auto max-w-3xl">
            <p className="eyebrow">Rechtliches</p>
            <h1 className="display-heading mt-3 text-3xl sm:text-4xl">{title}</h1>
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

export function legalMetadata(title: string, description: string): Metadata {
  return {
    title: `${title} — Shrymp Logistics`,
    description,
    openGraph: {
      title: `${title} — Shrymp Logistics`,
      description,
      type: "website",
      locale: "de_DE",
    },
  };
}
