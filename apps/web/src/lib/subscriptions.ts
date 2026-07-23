import "server-only";
import {
  PLANS,
  intervalMonths,
  planPrice,
  type BillingInterval,
  type GrowCallback,
  type PlanId,
} from "@kesher/billing";
import { prisma } from "@kesher/db";

/** Add whole months to a date (clamps to end-of-month naturally via Date). */
function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Grow's unique id for a charge — our idempotency key. */
function externalId(cb: GrowCallback): string | null {
  return cb.transactionId ?? cb.asmachta ?? cb.transactionToken ?? null;
}

export interface ApplyResult {
  applied: boolean;
  reason?: "duplicate" | "bad_fields" | "unknown_org";
}

/**
 * Turn a VERIFIED Grow payment callback into subscription + payment state.
 * Idempotent: a replayed delivery for the same transaction is a no-op. Handles
 * both the first charge and recurring renewals (same shape, later date).
 */
export async function applyGrowPayment(cb: GrowCallback): Promise<ApplyResult> {
  const orgId = cb.cField1;
  const plan = cb.cField2 as PlanId | undefined;
  const interval = (cb.cField3 as BillingInterval | undefined) ?? "MONTHLY";
  const ext = externalId(cb);

  if (!orgId || !plan || !(plan in PLANS) || !ext) {
    return { applied: false, reason: "bad_fields" };
  }

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return { applied: false, reason: "unknown_org" };

  // Idempotency gate: claim this delivery before doing anything.
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { provider: "grow", externalId: ext } },
  });
  if (existing?.processedAt) return { applied: false, reason: "duplicate" };
  if (!existing) {
    await prisma.webhookEvent
      .create({ data: { provider: "grow", externalId: ext, payload: cb as object } })
      .catch(() => {}); // race: another delivery created it first — fall through, upsert below is safe
  }

  const now = new Date();
  const periodEnd = addMonths(now, intervalMonths(interval));
  const priceIls = planPrice(plan, interval);

  await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        plan,
        interval,
        priceIls,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        growProcessId: cb.processId ?? null,
        growAsmachta: cb.asmachta ?? null,
      },
      update: {
        plan,
        interval,
        priceIls,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        growProcessId: cb.processId ?? null,
        growAsmachta: cb.asmachta ?? null,
      },
    });

    await tx.payment.create({
      data: {
        organizationId: orgId,
        subscriptionId: sub.id,
        amountIls: cb.sum ? Math.round(Number(cb.sum)) : priceIls,
        status: "PAID",
        growTransactionId: ext,
        growAsmachta: cb.asmachta ?? null,
        cardSuffix: cb.cardSuffix ?? null,
        cardBrand: cb.cardBrand ?? null,
        invoiceUrl: cb.invoiceUrl ?? null,
        paidAt: now,
      },
    });

    // Denormalized quick-read used across the dashboard for gating.
    await tx.organization.update({ where: { id: orgId }, data: { plan } });

    await tx.webhookEvent.update({
      where: { provider_externalId: { provider: "grow", externalId: ext } },
      data: { processedAt: now, payload: cb as object },
    });
  });

  return { applied: true };
}
