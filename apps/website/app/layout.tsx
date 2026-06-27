import type { Metadata } from "next";
import { Calistoga, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const calistoga = Calistoga({
  variable: "--font-calistoga",
  subsets: ["latin"],
  weight: ["400"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Monolith — Lagerlogistik mit Chargen & MHD für Shopify",
  description:
    "Chargenführung, intelligente Allocation und FEFO-Picking für Shopify-Händler mit MHD-pflichtigen Produkten. Jetzt Beta starten.",
  openGraph: {
    title: "Monolith — Lagerlogistik für Shopify",
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
      className={`${inter.variable} ${calistoga.variable} ${jetbrains.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-dvh font-sans text-foreground">{children}</body>
    </html>
  );
}
