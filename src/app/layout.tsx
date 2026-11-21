import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display-face", display: "swap" });
const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Funcionário 24h", template: "%s · Funcionário 24h" },
  description: "Funcionários digitais com IA que atendem, vendem e agendam pelo WhatsApp. Sua empresa nunca trabalha sozinha.",
};

export const viewport: Viewport = { themeColor: "#164D38" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
