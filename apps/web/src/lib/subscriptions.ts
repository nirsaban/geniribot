import "server-only";
import {
  growChargeIls,
  growExternalId,
  growPayments,
  growPlan,
  planPrice,
  type GrowCallback,
  type PlanId,
} from "@kesher/billing";
import { prisma } from "@kesher/db";
import { normalizePhone } from "./audience";
import { getPlanCatalog } from "./plan";

/** Add whole months to a date (clamps to end-of-month naturally via Date). */
function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

export interface ApplyResult {
  applied: boolean;
  reason?: "duplicate" | "unresolved_plan" | "bad_fields" | "unclaimed" | "not_found";
  plan?: PlanId;
  months?: number;
}

interface ChargeInput {
  /** Amount of this single charge, ILS. */
  amountIls: number;
  /** Monthly payments the standing order was opened for = months of access bought. */
  paymentsCount: number;
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
}

/**
 * Apply a charge to an org: open (or top up) the subscription and file the
 * payment. Shared by the claim path and any future direct path.
 *
 * A purchase is a הוראת קבע of N monthly payments, and we open the plan for
 * the whole N months on the FIRST charge — that's what the tenant committed
 * to, and it means access never flickers if a later charge is late.
 *
 * The remaining N−1 charges then arrive one a month. Grow gives each its own
 * transaction id and we can't reliably tell "payment 4 of 12" apart from a
 * brand-new purchase, so the rule is positional instead: a charge landing
 * while the same plan is still covered is a renewal of that standing order —
 * record the money, leave the period alone. A charge for a different plan, or
 * one arriving after the period lapsed, starts a fresh N-month grant.
 */
async function applyCharge(orgId: string, plan: PlanId, charge: ChargeInput): Promise<void> {
  const priceIls = charge.amountIls || planPrice(plan, await getPlanCatalog());

  await prisma.$transaction(async (tx) => {
    const existing = await tx.subscription.findUnique({ where: { organizationId: orgId } });
    const covered =
      existing?.status === "ACTIVE" &&
      existing.plan === plan &&
      existing.currentPeriodEnd != null &&
      existing.currentPeriodEnd > charge.paidAt;

    const currentPeriodStart = covered ? existing.currentPeriodStart : charge.paidAt;
    const currentPeriodEnd = covered
      ? existing.currentPeriodEnd
      : addMonths(charge.paidAt, charge.paymentsCount);

    const sub = await tx.subscription.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        plan,
        paymentsCount: charge.paymentsCount,
        priceIls,
        status: "ACTIVE",
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        growProcessId: charge.growProcessId ?? null,
        growAsmachta: charge.growAsmachta ?? null,
        growCardToken: charge.growCardToken ?? null,
        growCardHolderName: charge.growCardHolderName ?? null,
        growCardHolderPhone: charge.growCardHolderPhone ?? null,
      },
      update: {
        plan,
        priceIls,
        status: "ACTIVE",
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        // A renewal keeps the length it was opened with; a new grant resets it.
        ...(covered ? {} : { paymentsCount: charge.paymentsCount }),
        growProcessId: charge.growProcessId ?? existing?.growProcessId ?? null,
        growAsmachta: charge.growAsmachta ?? null,
        // A renewal callback may not repeat the token — keep the one we already have.
        ...(charge.growCardToken ? { growCardToken: charge.growCardToken } : {}),
        ...(charge.growCardHolderName ? { growCardHolderName: charge.growCardHolderName } : {}),
        ...(charge.growCardHolderPhone ? { growCardHolderPhone: charge.growCardHolderPhone } : {}),
      },
    });

    await tx.payment.create({
      data: {
        organizationId: orgId,
        subscriptionId: sub.id,
        amountIls: priceIls,
        status: "PAID",
        growTransactionId: charge.growTransactionId,
        growAsmachta: charge.growAsmachta ?? null,
        growProcessId: charge.growProcessId ?? null,
        cardSuffix: charge.cardSuffix ?? null,
        cardBrand: charge.cardBrand ?? null,
        invoiceUrl: charge.invoiceUrl ?? null,
        paidAt: charge.paidAt,
      },
    });

    // Denormalized quick-read used across the dashboard for gating.
    await tx.organization.update({ where: { id: orgId }, data: { plan } });
  });
}

/**
 * Super-admin manual activation — produces the same end state a real Grow
 * purchase does (an ACTIVE `Subscription` **plus** the denormalized
 * `Organization.plan`), just without a `Payment` row since no money moved.
 *
 * Writing `Organization.plan` alone is NOT enough: `effectivePlan` treats a
 * paid org with no active subscription as lapsed and `effectivePlanForOrg`
 * self-heals the field straight back to FREE, so the tenant kept being asked
 * to upgrade. Everything plan-gated goes through that check (dashboard,
 * gateway usage, worker follow-ups), so the subscription row is what actually
 * unlocks access.
 *
 * `currentPeriodEnd` is left null = never expires: a comped account keeps its
 * plan until an admin changes it (`effectivePlan` only expires a dated period).
 * Downgrading to FREE cancels the subscription but leaves its plan/period
 * history intact.
 */
export async function setPlanManually(orgId: string, plan: PlanId): Promise<void> {
  const now = new Date();

  if (plan === "FREE") {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { organizationId: orgId },
        data: { status: "CANCELED", canceledAt: now, cancelAtPeriodEnd: false },
      });
      await tx.organization.update({ where: { id: orgId }, data: { plan: "FREE" } });
    });
    return;
  }

  const priceIls = planPrice(plan, await getPlanCatalog());
  await prisma.$transaction(async (tx) => {
    await tx.subscription.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        plan,
        paymentsCount: 1,
        priceIls,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      update: {
        plan,
        priceIls,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
      },
    });
    await tx.organization.update({ where: { id: orgId }, data: { plan } });
  });
}

/**
 * The org a charge belongs to, when we can tell without asking.
 *
 * The first charge of a standing order is genuinely anonymous, but the eleven
 * monthly renewals behind it are not: by then the payer has claimed their
 * first payment, so the same phone/email (or the same Grow process id) points
 * straight back at their org. Without this every renewal would park itself as
 * unclaimed and quietly wait for a thank-you page visit that never comes.
 */
async function orgForRepeatPayer(cb: GrowCallback): Promise<string | null> {
  const phone = cb.payerPhone ? normalizePhone(cb.payerPhone) : null;
  const email = cb.payerEmail?.trim().toLowerCase() || null;

  if (cb.processId) {
    const sub = await prisma.subscription.findFirst({
      where: { growProcessId: cb.processId },
      select: { organizationId: true },
    });
    if (sub) return sub.organizationId;
  }

  const identifiers = [phone ? { payerPhone: phone } : undefined, email ? { payerEmail: email } : undefined].filter(
    (c): c is NonNullable<typeof c> => Boolean(c),
  );
  if (identifiers.length === 0) return null;

  const prior = await prisma.unclaimedGrowPayment.findFirst({
    where: { claimedByOrgId: { not: null }, OR: identifiers },
    orderBy: { paidAt: "desc" },
    select: { claimedByOrgId: true },
  });
  if (!prior?.claimedByOrgId) return null;

  // The org may have been deleted since; don't resurrect it.
  const org = await prisma.organization.findUnique({
    where: { id: prior.claimedByOrgId },
    select: { id: true },
  });
  return org?.id ?? null;
}

/**
 * Record a successful Grow charge.
 *
 * The payment page is a single untagged link, so a first-time callback never
 * says which account it belongs to — it says which product was bought, for how
 * many monthly payments, and who paid. Such a charge is parked as an
 * `UnclaimedGrowPayment` and attached to an org by phone/email the moment the
 * payer registers or logs in (`claimUnclaimedPayment`); for someone who
 * already has an account that happens seconds later on the thank-you page.
 * A charge from a payer we've seen before is applied to their org directly.
 *
 * Idempotent: a replayed delivery for the same transaction is a no-op.
 */
export async function applyGrowPayment(cb: GrowCallback): Promise<ApplyResult> {
  const ext = growExternalId(cb);
  if (!ext) return { applied: false, reason: "bad_fields" };

  const catalog = await getPlanCatalog();
  const plan = growPlan(cb, catalog);
  const paymentsCount = growPayments(cb);

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
  const markProcessed = () =>
    prisma.webhookEvent.update({
      where: { provider_externalId: { provider: "grow", externalId: ext } },
      data: { processedAt: now, payload: cb as object },
    });

  // An unrecognised product/amount is left unprocessed on purpose: the raw
  // payload stays in WebhookEvent for the super admin to inspect, and a
  // corrected redelivery can still be applied.
  if (!plan) return { applied: false, reason: "unresolved_plan" };

  const amountIls = growChargeIls(cb) ?? planPrice(plan, catalog);
  const knownOrg = await orgForRepeatPayer(cb);
  if (knownOrg) {
    await applyCharge(knownOrg, plan, {
      amountIls,
      paymentsCount,
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
    });
    await markProcessed();
    return { applied: true, plan, months: paymentsCount };
  }

  await prisma.unclaimedGrowPayment
    .create({
      data: {
        growTransactionId: ext,
        plan,
        paymentsCount,
        amountIls,
        payerPhone: cb.payerPhone ? (normalizePhone(cb.payerPhone) ?? cb.payerPhone) : null,
        payerEmail: cb.payerEmail?.trim().toLowerCase() || null,
        cardSuffix: cb.cardSuffix ?? null,
        cardBrand: cb.cardBrand ?? null,
        invoiceUrl: cb.invoiceUrl ?? null,
        paidAt: now,
      },
    })
    .catch(() => {}); // duplicate delivery — already parked

  await markProcessed();
  return { applied: false, reason: "unclaimed", plan, months: paymentsCount };
}

/**
 * Attach one specific unclaimed payment to an org — the super admin's manual
 * override for a payer whose Grow phone/email matches nothing we hold, so the
 * automatic claim can never fire on its own.
 */
export async function claimPaymentById(orgId: string, paymentId: string): Promise<ApplyResult> {
  const claim = await prisma.unclaimedGrowPayment.updateMany({
    where: { id: paymentId, claimedAt: null },
    data: { claimedAt: new Date(), claimedByOrgId: orgId },
  });
  if (claim.count === 0) return { applied: false, reason: "not_found" };

  const match = await prisma.unclaimedGrowPayment.findUniqueOrThrow({ where: { id: paymentId } });
  await applyCharge(orgId, match.plan, {
    amountIls: Number(match.amountIls),
    paymentsCount: match.paymentsCount,
    growTransactionId: match.growTransactionId,
    cardSuffix: match.cardSuffix,
    cardBrand: match.cardBrand,
    invoiceUrl: match.invoiceUrl,
    paidAt: match.paidAt,
  });
  return { applied: true, plan: match.plan, months: match.paymentsCount };
}

/**
 * Attach an unclaimed Grow payment to an org by the phone or email the payer
 * used on Grow's page — called right after registration/login, and from the
 * thank-you page. Most recent unclaimed match wins.
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

  await applyCharge(orgId, match.plan, {
    amountIls: Number(match.amountIls),
    paymentsCount: match.paymentsCount,
    growTransactionId: match.growTransactionId,
    cardSuffix: match.cardSuffix,
    cardBrand: match.cardBrand,
    invoiceUrl: match.invoiceUrl,
    paidAt: match.paidAt,
  });
  return { applied: true, plan: match.plan, months: match.paymentsCount };
}
