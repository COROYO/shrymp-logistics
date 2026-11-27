"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { BrandMark } from "@/app/_components/brand-mark";
import { logisticsUrl } from "@/lib/config";

const navLinks = [
  { href: "#problem", label: "Problem" },
  { href: "#features", label: "Lösung" },
  { href: "#ablauf", label: "Ablauf" },
  { href: "#faq", label: "FAQ" },
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b bg-brand-cream transition-[border-color] duration-150 ease-craft ${
        scrolled || menuOpen ? "border-brand-ink/10" : "border-transparent"
      }`}
    >
      <div className="container-narrow flex h-16 items-center justify-between px-6 lg:px-8">
        <Link
          href="/"
          className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-burgundy/40 focus-visible:ring-offset-2"
        >
          <BrandMark />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Hauptnavigation">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-secondary transition-colors duration-150 ease-craft hover:text-brand-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/20 focus-visible:ring-offset-2"
            >
              {link.label}
            </a>
          ))}
          <a href={logisticsUrl} className="btn-nav ml-2">
            Beta starten
          </a>
        </nav>

        <button
          type="button"
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-lg border border-brand-ink/10 bg-white text-brand-navy md:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/30"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? "Menü schließen" : "Menü öffnen"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? (
            <X className="size-4" strokeWidth={1.5} aria-hidden />
          ) : (
            <Menu className="size-4" strokeWidth={1.5} aria-hidden />
          )}
        </button>
      </div>

      {menuOpen ? (
        <nav
          id="mobile-nav"
          className="border-t border-brand-ink/10 bg-brand-cream px-6 py-4 md:hidden"
          aria-label="Mobile Navigation"
        >
          <ul className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="block min-h-11 rounded-lg px-3 py-3 text-sm font-medium text-secondary transition-colors duration-150 ease-craft hover:bg-white hover:text-brand-navy"
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="pt-2">
              <a
                href={logisticsUrl}
                className="btn-primary w-full"
                onClick={() => setMenuOpen(false)}
              >
                Beta starten
              </a>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
