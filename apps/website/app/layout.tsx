import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Monolith — Lager & Chargen für Shopify",
  description:
    "Chargenführung, intelligente Allocation und FEFO-Picking für Shopify-Händler mit MHD-pflichtigen Produkten.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full bg-brand-cream text-brand-ink">{children}</body>
    </html>
  );
}
