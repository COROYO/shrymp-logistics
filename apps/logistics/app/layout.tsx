import type { Metadata } from "next";
import { Montserrat, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { pickClientMessages } from "@/i18n/client-messages";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Shrymp Logistics",
  description: "Kommissionierung & Chargenführung",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = pickClientMessages(
    (await getMessages()) as Record<string, unknown>,
  );
  return (
    <html
      lang={locale}
      className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* Extensions (e.g. ColorZilla) inject body attrs before hydration. */}
      <body
        className="min-h-full flex flex-col bg-brand-cream text-brand-ink"
        suppressHydrationWarning
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
