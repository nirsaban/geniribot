import Link from "next/link";
import { prisma } from "@kesher/db";
import { LogoMark } from "@/components/Logo";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { claimUnclaimedPayment } from "@/lib/subscriptions";
import { claimPaymentAction } from "@/app/dashboard/billing/actions";

export const dynamic = "force-dynamic";

/**
 * Redirect target after a Grow hosted-payment-page checkout (configured as
 * that page's success URL in the Grow dashboard). The payment itself is
 * never re-verified here (that already happened in the webhook) — this page
 * only tries to ATTACH an already-recorded payment to an account:
 *  - logged in (paid via the in-app "upgrade" flow): try the account's own
 *    email automatically.
 *  - logged out (paid straight from the landing page): send them to
 *    register, where the same claim happens with the phone/email they paid
 *    with (see registerAction).
 */
export default async function ThankYouPage() {
  const session = await getSession();
  if (!session) return <LoggedOutThankYou />;

  const user = await prisma.user.findUnique({ where: { id: session.sub }, select: { email: true } });
  const claimed = user ? (await claimUnclaimedPayment(session.org, user.email)).applied : false;

  return (
    <Shell>
      {claimed ? (
        <>
          <p className="text-sm leading-relaxed text-slate-600">{he.thankYouClaimedBody}</p>
          <Link href="/dashboard/billing" className="btn-primary mt-6 block w-full py-2.5">
            {he.thankYouGoToDashboard}
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-slate-600">{he.thankYouNotFoundBody}</p>
          <form action={claimPaymentAction} className="mt-4 space-y-2">
            <input
              name="identifier"
              placeholder={he.claimPaymentLabel}
              dir="ltr"
              className="input w-full text-left"
            />
            <button className="btn-primary w-full py-2.5">{he.thankYouTryMatch}</button>
          </form>
          <Link href="/dashboard/billing" className="mt-3 block text-sm text-slate-500 hover:underline">
            {he.thankYouGoToDashboard}
          </Link>
        </>
      )}
    </Shell>
  );
}

function LoggedOutThankYou() {
  return (
    <Shell>
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
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden mesh-bg p-4">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 animate-blob rounded-full bg-brand/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 animate-blob rounded-full bg-blue-400/20 blur-3xl" style={{ animationDelay: "3s" }} />

      <div className="relative w-full max-w-sm animate-fade-up text-center">
        <span className="logo-3d mb-4 inline-grid h-16 w-16 animate-float place-items-center rounded-2xl text-white">
          <LogoMark className="h-9 w-9" />
        </span>
        <h1 className="gradient-text text-3xl font-black">{he.thankYouTitle}</h1>
        <div className="card animate-pop mt-6 p-7 backdrop-blur">{children}</div>
      </div>
    </div>
  );
}
