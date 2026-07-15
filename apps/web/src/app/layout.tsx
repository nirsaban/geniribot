import type { Metadata } from "next";
import { he } from "@/lib/he";
import "./globals.css";

export const metadata: Metadata = {
  title: he.appName,
  description: he.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
