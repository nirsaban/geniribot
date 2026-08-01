import "server-only";
import type { BillingInterval, PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";

/** The platform (super-admin) organization that owns the Grow payment links. */
export async function platformOrgId(): Promise<string | null> {
  const o = await prisma.organization.findUnique({
    where: { slug: "platform" },
    select: { id: true },
  });
  return o?.id ?? null;
}

export type PaidPlanId = Exclude<PlanId, "FREE">;

export type GrowPaymentUrls = Record<PaidPlanId, Record<BillingInterval, string | null>>;

/**
 * The static Grow-hosted payment pages, one per plan × billing interval —
 * each has its own fixed price configured directly in Grow (super admin
 * pastes the link once it's created there; see /admin).
 */
export async function getGrowPaymentUrls(): Promise<GrowPaymentUrls> {
  const org = await platformOrgId();
  const row = org
    ? await prisma.organization.findUnique({
        where: { id: org },
        select: {
          growPaymentUrlStarterMonthly: true,
          growPaymentUrlStarterAnnual: true,
          growPaymentUrlProMonthly: true,
          growPaymentUrlProAnnual: true,
        },
      })
    : null;
  return {
    STARTER: { MONTHLY: row?.growPaymentUrlStarterMonthly ?? null, ANNUAL: row?.growPaymentUrlStarterAnnual ?? null },
    PRO: { MONTHLY: row?.growPaymentUrlProMonthly ?? null, ANNUAL: row?.growPaymentUrlProAnnual ?? null },
  };
}

export async function growPaymentUrlFor(plan: PaidPlanId, interval: BillingInterval): Promise<string | null> {
  const urls = await getGrowPaymentUrls();
  return urls[plan][interval];
}

/**
 * Tag a Grow payment link with the organization it's for — Grow echoes
 * custom fields back on the notifyUrl callback, which is how
 * `applyGrowPayment` knows which org to activate (see
 * `apps/web/src/lib/subscriptions.ts`).
 */
export function withOrgField(url: string, orgId: string): string {
  const u = new URL(url);
  u.searchParams.set("cField1", orgId);
  return u.toString();
}
