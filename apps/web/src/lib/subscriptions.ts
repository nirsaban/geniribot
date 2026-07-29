import "server-only";
import { randomUUID } from "node:crypto";
import {
  intervalMonths,
  planAndIntervalFromAmount,
  planPrice,
  type BillingInterval,
  type GrowCallback,
  type Plan,
  type PlanId,
} from "@kesher/billing";
import { prisma } from "@kesher/db";
import { normalizePhone } from "./audience";
import { growPlatformProvider } from "./billing";
import { getPlanCatalog } from "./plan";

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

/** cField2/cField3 when present and valid, else recovered from the charged amount. */
function resolvePlan(
  cb: GrowCallback,
  catalog: Record<PlanId, Plan>,
): { plan: PlanId; interval: BillingInterval } | null {
  const cFieldPlan = cb.cField2 as PlanId | undefined;
  if (cFieldPlan && cFieldPlan in catalog && cFieldPlan !== "FREE") {
    const cFieldInterval = (cb.cField3 as BillingInterval | undefined) ?? "MONTHLY";
    return { plan: cFieldPlan, interval: cFieldInterval };
  }
  return cb.sum ? planAndIntervalFromAmount(Math.round(Number(cb.sum)), catalog) : null;
}

export interface ApplyResult {
  applied: boolean;
  reason?: "duplicate" | "bad_fields" | "unknown_org" | "unclaimed" | "not_found";
}

/** Activate plan/subscription/payment for an org — shared by direct and claimed paths. */
async function activatePlan(
  orgId: string,
  plan: PlanId,
  interval: BillingInterval,
  payment: {
    amountIls: number;
    growTransactionId: string;
    growAsmachta?: string | null;
    growProcessId?: string | null;
    growCardToken?: string | null;
    growCardHolderName?: string | null;
    growCardHolderPhone?: string | null;
    cardSuffix?: string | null;
    cardBrand?: string | null;
    invoiceUrl?: string | null;
    paidAt: Date;
  },
): Promise<void> {
  const periodEnd = addMonths(payment.paidAt, intervalMonths(interval));
  const priceIls = payment.amountIls || planPrice(plan, interval, await getPlanCatalog());

  await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        plan,
        interval,
        priceIls,
        status: "ACTIVE",
        currentPeriodStart: payment.paidAt,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        growProcessId: payment.growProcessId ?? null,
        growAsmachta: payment.growAsmachta ?? null,
        growCardToken: payment.growCardToken ?? null,
        growCardHolderName: payment.growCardHolderName ?? null,
        growCardHolderPhone: payment.growCardHolderPhone ?? null,
      },
      update: {
        plan,
        interval,
        priceIls,
        status: "ACTIVE",
        currentPeriodStart: payment.paidAt,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        growProcessId: payment.growProcessId ?? null,
        growAsmachta: payment.growAsmachta ?? null,
        // A renewal callback may not repeat the token — keep the one we already have.
        ...(payment.growCardToken ? { growCardToken: payment.growCardToken } : {}),
        ...(payment.growCardHolderName ? { growCardHolderName: payment.growCardHolderName } : {}),
        ...(payment.growCardHolderPhone ? { growCardHolderPhone: payment.growCardHolderPhone } : {}),
      },
    });

    await tx.payment.create({
      data: {
        organizationId: orgId,
        subscriptionId: sub.id,
        amountIls: priceIls,
        status: "PAID",
        growTransactionId: payment.growTransactionId,
        growAsmachta: payment.growAsmachta ?? null,
        cardSuffix: payment.cardSuffix ?? null,
        cardBrand: payment.cardBrand ?? null,
        invoiceUrl: payment.invoiceUrl ?? null,
        paidAt: payment.paidAt,
      },
    });

    // Denormalized quick-read used across the dashboard for gating.
    await tx.organization.update({ where: { id: orgId }, data: { plan } });
  });
}

/**
 * Turn a VERIFIED Grow payment callback into subscription + payment state.
 * Idempotent: a replayed delivery for the same transaction is a no-op. Handles
 * both the first charge and recurring renewals (same shape, later date).
 *
 * cField1 (organizationId) is only present when we generated the checkout
 * link ourselves. A payment made through a static hosted page (no custom
 * fields) is parked as an `UnclaimedGrowPayment` instead of discarded —
 * `claimUnclaimedPayment` attaches it once the payer registers or logs in
 * and matches it by the phone/email they paid with.
 */
export async function applyGrowPayment(cb: GrowCallback): Promise<ApplyResult> {
  const orgId = cb.cField1;
  const ext = externalId(cb);
  const catalog = await getPlanCatalog();
  const resolved = resolvePlan(cb, catalog);
  if (!ext || !resolved) return { applied: false, reason: "bad_fields" };
  const { plan, interval } = resolved;

  // Idempotency gate: claim this delivery before doing anything.
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { provider: "grow", externalId: ext } },
  });
  if (existing?.processedAt) return { applied: false, reason: "duplicate" };
  if (!existing) {
    await prisma.webhookEvent
      .create({ data: { provider: "grow", externalId: ext, payload: cb as object } })
      .catch(() => {}); // race: another delivery created it first — fall through is safe
  }

  const now = new Date();
  const paymentInput = {
    amountIls: cb.sum ? Math.round(Number(cb.sum)) : planPrice(plan, interval, catalog),
    growTransactionId: ext,
    growAsmachta: cb.asmachta ?? null,
    growProcessId: cb.processId ?? null,
    growCardToken: cb.cardToken ?? null,
    growCardHolderName: cb.fullName ?? null,
    growCardHolderPhone: cb.payerPhone ?? null,
    cardSuffix: cb.cardSuffix ?? null,
    cardBrand: cb.cardBrand ?? null,
    invoiceUrl: cb.invoiceUrl ?? null,
    paidAt: now,
  };

  let result: ApplyResult;
  if (orgId && (await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }))) {
    await activatePlan(orgId, plan, interval, paymentInput);
    result = { applied: true };
  } else if (orgId) {
    result = { applied: false, reason: "unknown_org" };
  } else {
    await prisma.unclaimedGrowPayment
      .create({
        data: {
          growTransactionId: ext,
          plan,
          interval,
          amountIls: paymentInput.amountIls,
          payerPhone: cb.payerPhone ? (normalizePhone(cb.payerPhone) ?? cb.payerPhone) : null,
          payerEmail: cb.payerEmail?.trim().toLowerCase() || null,
          cardSuffix: paymentInput.cardSuffix,
          cardBrand: paymentInput.cardBrand,
          invoiceUrl: paymentInput.invoiceUrl,
          paidAt: now,
        },
      })
      .catch(() => {}); // duplicate delivery — already parked
    result = { applied: false, reason: "unclaimed" };
  }

  await prisma.webhookEvent.update({
    where: { provider_externalId: { provider: "grow", externalId: ext } },
    data: { processedAt: now, payload: cb as object },
  });
  return result;
}

/**
 * Attach an unclaimed Grow payment to an org by the phone or email the payer
 * used on Grow's page — called right after registration/login for someone
 * who paid before they had an account. Most recent unclaimed match wins.
 */
export async function claimUnclaimedPayment(orgId: string, identifier: string): Promise<ApplyResult> {
  const phone = normalizePhone(identifier);
  const email = identifier.trim().toLowerCase();
  const looksLikeEmail = email.includes("@");
  if (!phone && !looksLikeEmail) return { applied: false, reason: "not_found" };

  const match = await prisma.unclaimedGrowPayment.findFirst({
    where: {
      claimedAt: null,
      OR: [phone ? { payerPhone: phone } : undefined, looksLikeEmail ? { payerEmail: email } : undefined].filter(
        (c): c is NonNullable<typeof c> => Boolean(c),
      ),
    },
    orderBy: { paidAt: "desc" },
  });
  if (!match) return { applied: false, reason: "not_found" };

  // Guard against a double-claim race: only proceed if we win the claim.
  const claim = await prisma.unclaimedGrowPayment.updateMany({
    where: { id: match.id, claimedAt: null },
    data: { claimedAt: new Date(), claimedByOrgId: orgId },
  });
  if (claim.count === 0) return { applied: false, reason: "not_found" };

  await activatePlan(orgId, match.plan, match.interval, {
    amountIls: match.amountIls,
    growTransactionId: match.growTransactionId,
    cardSuffix: match.cardSuffix,
    cardBrand: match.cardBrand,
    invoiceUrl: match.invoiceUrl,
    paidAt: match.paidAt,
  });
  return { applied: true };
}

export interface ChargeOrgResult {
  ok: boolean;
  error?: "not_configured" | "no_saved_card" | "charge_failed";
  transactionId?: string;
}

/**
 * Super-admin: charge an org's previously-saved Grow card token for an
 * arbitrary amount — no payment page/link is shown to the customer. Requires
 * the org to have completed at least one checkout (which saves the token) and
 * the platform's chargeToken webhook to be configured.
 */
export async function chargeOrgCardToken(
  orgId: string,
  sumIls: number,
  description: string,
): Promise<ChargeOrgResult> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId: orgId },
    select: { id: true, growCardToken: true, growCardHolderName: true, growCardHolderPhone: true },
  });
  if (!sub?.growCardToken || !sub.growCardHolderName || !sub.growCardHolderPhone) {
    return { ok: false, error: "no_saved_card" };
  }

  const provider = await growPlatformProvider();
  if (!provider) return { ok: false, error: "not_configured" };

  try {
    const { transactionId } = await provider.chargeToken({
      cardToken: sub.growCardToken,
      sumIls,
      description,
      uniqueIdentifier: `admin-charge-${orgId}-${randomUUID()}`,
      payerName: sub.growCardHolderName,
      payerPhone: sub.growCardHolderPhone,
      organizationId: orgId,
    });

    await prisma.payment.create({
      data: {
        organizationId: orgId,
        subscriptionId: sub.id,
        amountIls: sumIls,
        status: "PAID",
        growTransactionId: transactionId ?? `admin-charge-${randomUUID()}`,
        paidAt: new Date(),
      },
    });

    return { ok: true, transactionId };
  } catch {
    return { ok: false, error: "charge_failed" };
  }
}
