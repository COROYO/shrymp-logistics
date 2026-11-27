import Link from "next/link";
import { contactEmail, logisticsUrl } from "@/lib/config";
import { BrandMark } from "@/app/_components/brand-mark";

export function SiteFooter() {
  return (
    <footer className="border-t border-brand-navy-soft bg-brand-navy text-white">
      <div className="container-narrow px-6 py-16 lg:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <BrandMark variant="dark" />
            <p className="mt-4 text-sm leading-5 text-stone-300">
              Kommissionierung, Chargenführung und Allocation — gebaut für
              Shopify-Händler mit MHD-pflichtigen Produkten
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
            <div>
              <p className="font-medium text-stone-200">Produkt</p>
              <ul className="mt-3 space-y-2 text-stone-400">
                <li>
                  <a
                    href="#features"
                    className="transition-colors duration-150 ease-craft hover:text-white"
                  >
                    Features
                  </a>
                </li>
                <li>
                  <a
                    href="#ablauf"
                    className="transition-colors duration-150 ease-craft hover:text-white"
                  >
                    Ablauf
                  </a>
                </li>
                <li>
                  <a
                    href="#faq"
                    className="transition-colors duration-150 ease-craft hover:text-white"
                  >
                    FAQ
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-stone-200">Beta</p>
              <ul className="mt-3 space-y-2 text-stone-400">
                <li>
                  <a
                    href={logisticsUrl}
                    className="transition-colors duration-150 ease-craft hover:text-white"
                  >
                    App öffnen
                  </a>
                </li>
                <li>
                  <a
                    href={logisticsUrl}
                    className="transition-colors duration-150 ease-craft hover:text-white"
                  >
                    Shopify verbinden
                  </a>
                </li>
              </ul>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="font-medium text-stone-200">Kontakt</p>
              <p className="mt-3 text-stone-400">
                <a
                  href={`mailto:${contactEmail}`}
                  className="transition-colors duration-150 ease-craft hover:text-white"
                >
                  {contactEmail}
                </a>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-8 text-xs text-stone-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Shrymp Logistics. Alle Rechte vorbehalten.</p>
          <nav
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
            aria-label="Rechtliches"
          >
            <Link
              href="/impressum"
              className="transition-colors duration-150 ease-craft hover:text-stone-300"
            >
              Impressum
            </Link>
            <Link
              href="/datenschutz"
              className="transition-colors duration-150 ease-craft hover:text-stone-300"
            >
              Datenschutz
            </Link>
            <Link
              href="/agb"
              className="transition-colors duration-150 ease-craft hover:text-stone-300"
            >
              AGB
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
