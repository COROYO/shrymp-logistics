import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { pickClientMessages } from "@/i18n/client-messages";
import "./globals.css";

// Variable latin files. Google Fonts now serves kit URLs without a file
// extension, which crashes next/font/google during `next build`.
const montserrat = localFont({
  src: "./fonts/montserrat-latin.woff2",
  weight: "400 700",
  variable: "--font-montserrat",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  weight: "400 700",
  variable: "--font-jetbrains-mono",
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
