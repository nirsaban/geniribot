import { NextResponse } from "next/server";
import { prisma } from "@kesher/db";
import { getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";
import { claimUnclaimedPayment } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

/**
 * Try to attach a Grow payment to the signed-in account.
 *
 * The thank-you page polls this. Grow bounces the payer back to us the moment
 * the card clears, which can beat its own server-to-server callback — so "no
 * payment found" right after checkout usually means "not yet", not "never".
 * Retrying for a few seconds turns that race into a non-event.
 *
 * With no identifier we try what we already know about the account (its login
 * email, then the agent's WhatsApp number); an identifier from the manual form
 * covers paying with details that match neither.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { identifier?: string };
  const typed = body.identifier?.trim();

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { email: true, notifyPhone: true },
  });
  const candidates = typed
    ? [typed]
    : [user?.email, user?.notifyPhone].filter((v): v is string => Boolean(v));

  for (const identifier of candidates) {
    const result = await claimUnclaimedPayment(session.org, identifier);
    if (!result.applied) continue;

    const [catalog, subscription] = await Promise.all([
      getPlanCatalog(),
      prisma.subscription.findUnique({
        where: { organizationId: session.org },
        select: { currentPeriodEnd: true },
      }),
    ]);
    return NextResponse.json({
      claimed: true,
      plan: result.plan ? catalog[result.plan].name : null,
      months: result.months ?? 1,
      until: subscription?.currentPeriodEnd?.toISOString() ?? null,
    });
  }

  return NextResponse.json({ claimed: false });
}
