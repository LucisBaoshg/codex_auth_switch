import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Codex Auth Switch | Internal Portal",
  description: "Internal sharing and documentation portal for Codex Auth Switch",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased min-h-screen bg-neutral-50 text-neutral-900 selection:bg-indigo-200 dark:bg-neutral-950 dark:text-neutral-50 dark:selection:bg-indigo-500/30 transition-colors duration-300">
        <div className="fixed inset-0 -z-10 bg-gradient-to-br from-indigo-50 via-neutral-50 to-neutral-100 dark:bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] dark:from-indigo-900/20 dark:via-neutral-950 dark:to-neutral-950 transition-colors duration-300"></div>
        {children}
      </body>
    </html>
  );
}
