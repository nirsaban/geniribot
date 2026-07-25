import "server-only";
import {
  effectivePlan,
  loadPlanCatalog,
  planHasFeature,
  planLimits,
  type Feature,
  type Plan,
  type PlanId,
} from "@kesher/billing";
import { prisma } from "@kesher/db";

/** The live plan catalog (static defaults + any super-admin overrides). */
export async function getPlanCatalog(): Promise<Record<PlanId, Plan>> {
  return loadPlanCatalog(prisma);
}

/**
 * The plan actually in effect for an org right now. `Organization.plan` is a
 * denormalized quick-read that only moves forward on a successful Grow
 * webhook (see `applyGrowPayment`) — nothing ever rolls it back when a
 * subscription lapses (cancelled, or a renewal charge failed). This is the
 * single source of truth for gating: it self-heals a lapsed paid plan back to
 * FREE so "don't enable access until paid" holds even between webhook events.
 */
export async function effectivePlanForOrg(orgId: string): Promise<PlanId> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { plan: true, subscription: { select: { status: true, currentPeriodEnd: true } } },
  });
  if (!org) return "FREE";

  const plan = effectivePlan(org.plan as PlanId, org.subscription);
  if (plan === "FREE" && org.plan !== "FREE") {
    // Lapsed: correct the denormalized field so future reads (e.g. the
    // billing page) don't keep showing stale paid status.
    await prisma.organization.update({ where: { id: orgId }, data: { plan: "FREE" } }).catch(() => {});
  }
  return plan;
}

export async function requireFeature(orgId: string, feature: Feature): Promise<boolean> {
  return planHasFeature(await effectivePlanForOrg(orgId), feature);
}

export async function contactsLimitReached(orgId: string): Promise<boolean> {
  const [plan, catalog, count] = await Promise.all([
    effectivePlanForOrg(orgId),
    getPlanCatalog(),
    prisma.contact.count({ where: { organizationId: orgId } }),
  ]);
  return count >= planLimits(plan, catalog).contacts;
}
