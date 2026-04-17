import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { BrowserSupabaseProvider } from "@/components/supabase/BrowserSupabaseProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "VSL Swipe — Ads escalados",
  description: "Feed vertical de criativos e VSLs performando no Meta Ads",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className={`${inter.variable} font-sans antialiased bg-surface-950 text-zinc-100`}>
        <BrowserSupabaseProvider>{children}</BrowserSupabaseProvider>
      </body>
    </html>
  );
}
