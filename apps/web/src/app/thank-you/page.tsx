import Link from "next/link";
import { prisma } from "@kesher/db";
import { LogoMark } from "@/components/Logo";
import { he } from "@/lib/he";
import { getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";
import { claimUnclaimedPayment } from "@/lib/subscriptions";
import { ClaimWatcher } from "./ClaimWatcher";

export const dynamic = "force-dynamic";

/**
 * Where Grow returns the payer after a successful checkout (set as the
 * payment link's return URL in Grow's dashboard).
 *
 * The money is never verified here — that already happened in the webhook.
 * This page only ATTACHES an already-recorded payment to an account, because
 * the payment link is untagged and a callback arrives knowing only who paid,
 * not which tenant they are:
 *
 *  - signed in: match on the account's own details, retrying for a few
 *    seconds since the browser often arrives before Grow's callback does,
 *    then fall back to asking which phone/email they paid with.
 *  - signed out (paid straight from the landing page): send them to register,
 *    where the same match runs against the details they enter.
 */
export default async function ThankYouPage() {
  const session = await getSession();
  if (!session) return <LoggedOutThankYou />;

  // One attempt server-side so the common case renders already-claimed, with
  // no spinner and no round trip; ClaimWatcher takes over only if it missed.
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { email: true },
  });
  const result = user ? await claimUnclaimedPayment(session.org, user.email) : { applied: false };

  let initial = { claimed: false } as {
    claimed: boolean;
    plan?: string | null;
    months?: number;
    until?: string | null;
  };
  if (result.applied) {
    const [catalog, subscription] = await Promise.all([
      getPlanCatalog(),
      prisma.subscription.findUnique({
        where: { organizationId: session.org },
        select: { currentPeriodEnd: true },
      }),
    ]);
    initial = {
      claimed: true,
      plan: result.plan ? catalog[result.plan].name : null,
      months: result.months ?? 1,
      until: subscription?.currentPeriodEnd?.toISOString() ?? null,
    };
  }

  return (
    <Shell>
      <ClaimWatcher initial={initial} />
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
      <p className="mt-4 text-xs text-slate-400">{he.thankYouRegisterHint}</p>
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
