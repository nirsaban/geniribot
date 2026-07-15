import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import { he } from "@/lib/he";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-heebo",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${he.appName} — ${he.tagline}`,
  description: he.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
