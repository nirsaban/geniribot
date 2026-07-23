import Link from "next/link";
import { he } from "@/lib/he";

export const dynamic = "force-static";

/**
 * Redirect target after a Grow hosted-payment-page checkout (configured as
 * that page's success URL in the Grow dashboard). Static confirmation only —
 * the payment isn't looked up or verified here; reconciling it to an account
 * happens once they register (or, today, manually).
 */
export default function ThankYouPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden mesh-bg p-4">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 animate-blob rounded-full bg-brand/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 animate-blob rounded-full bg-blue-400/20 blur-3xl" style={{ animationDelay: "3s" }} />

      <div className="relative w-full max-w-sm animate-fade-up text-center">
        <span className="logo-3d mb-4 inline-grid h-16 w-16 animate-float place-items-center rounded-2xl text-3xl font-black text-white">
          G
        </span>
        <h1 className="gradient-text text-3xl font-black">{he.thankYouTitle}</h1>

        <div className="card animate-pop mt-6 p-7 backdrop-blur">
          <p className="text-sm leading-relaxed text-slate-600">{he.thankYouBody}</p>
          <Link href="/register" className="btn-primary mt-6 block w-full py-2.5">
            {he.thankYouCta}
          </Link>
          <p className="mt-4 text-sm text-slate-500">
            {he.thankYouHaveAccount}{" "}
            <Link href="/login" className="font-semibold text-brand">
              {he.loginCta}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
