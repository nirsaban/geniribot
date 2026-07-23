import { effectivePlan, planLimits, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";

function yearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Hard cap on outbound WhatsApp sends per org per calendar month, per the
 * org's plan — the single choke point every producer (bot replies,
 * broadcasts, reminders, follow-ups, manual sends) funnels through before a
 * message actually leaves. Checks the count before incrementing; a small
 * over-shoot is possible under heavy concurrency but that's fine for a usage
 * gate, not something that needs perfect atomicity.
 */
export async function canSendAndCount(organizationId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, subscription: { select: { status: true, currentPeriodEnd: true } } },
  });
  if (!org) return false;
  const plan = effectivePlan(org.plan as PlanId, org.subscription);
  const limit = planLimits(plan).monthlyMessages;

  const ym = yearMonth(new Date());
  const key = { organizationId_yearMonth: { organizationId, yearMonth: ym } };
  const usage = await prisma.messageUsage.upsert({
    where: key,
    create: { organizationId, yearMonth: ym },
    update: {},
  });
  if (usage.count >= limit) return false;

  await prisma.messageUsage.update({ where: key, data: { count: { increment: 1 } } });
  return true;
}
