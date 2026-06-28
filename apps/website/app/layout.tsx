import type { Metadata } from "next";
import { Montserrat, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Shrymp Logistics — Lagerlogistik mit Chargen & MHD für Shopify",
  description:
    "Chargenführung, intelligente Allocation und FEFO-Picking für Shopify-Händler mit MHD-pflichtigen Produkten. Jetzt Beta starten.",
  openGraph: {
    title: "Shrymp Logistics — Lagerlogistik für Shopify",
    description:
      "Allocation, Picking und Chargenzuweisung — wenn MHD und Rückverfolgbarkeit zählen.",
    type: "website",
    locale: "de_DE",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${montserrat.variable} ${jetbrains.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-dvh bg-brand-cream font-sans text-brand-ink">
        {children}
      </body>
    </html>
  );
}
