/**
 * Grow (Meshulam) payment-callback parsing.
 *
 * There is exactly ONE hosted Grow payment page for the whole platform. It
 * sells one product per paid plan and its only frequency is a הוראת קבע
 * (standing order) of 1–`MAX_PAYMENTS` monthly charges, chosen by the payer.
 * We never generate or tag a link, so a callback arrives with no idea who it
 * belongs to — everything we know has to be recovered from the payload:
 *
 *   which plan   ← the product name in `description`, amount as a fallback
 *   how long     ← how many payments the payer committed to
 *   who paid     ← payer phone / email, matched to an account afterwards
 */

import { MAX_PAYMENTS, PAID_PLANS, PLANS, type Plan, type PlanId } from "./plans.js";

/** Israeli VAT rate configured on the Grow page (`linkData.vat`). */
export const VAT_RATE = 0.18;

/**
 * Fields Grow POSTs to our notifyUrl (the subset we use). The callback is
 * form-encoded and unauthenticated — see the webhook route for what we do and
 * don't trust. Indexed so unrecognised keys survive into the audit log.
 */
export interface GrowCallback {
  err?: string;
  transactionId?: string;
  transactionToken?: string;
  asmachta?: string;
  processId?: string;
  processToken?: string;
  /** Charged amount for THIS charge (one payment of the standing order), ILS. */
  sum?: string;
  paymentDate?: string;
  status?: string;
  statusCode?: string;
  cardSuffix?: string;
  cardBrand?: string;
  cardType?: string;
  transactionTypeId?: string;
  /** Grow's frequency id — `1` is הוראת קבע on this page. */
  paymentType?: string;
  /** How many monthly payments the payer committed to (the `payment_num` they picked). */
  paymentsNum?: string;
  /** Which payment of the series this charge is (1-based), when Grow sends it. */
  currentPaymentNum?: string;
  /** Product names bought — how we identify the plan. */
  description?: string;
  fullName?: string;
  payerPhone?: string;
  payerEmail?: string;
  invoiceUrl?: string;
  cardToken?: string;
  [k: string]: string | undefined;
}

/**
 * Grow's checkout submits the chosen count as `payment_num`, but its callback
 * has been seen to echo it under several names. Try them in order rather than
 * betting on one — an unmatched count silently becomes a 1-month grant, which
 * is the expensive kind of wrong.
 */
const PAYMENTS_NUM_KEYS = [
  "paymentsNum",
  "paymentNum",
  "payment_num",
  "numOfPayments",
  "totalPaymentsNum",
  "paymentsNumber",
  "payments",
] as const;

const CURRENT_PAYMENT_KEYS = ["currentPaymentNum", "paymentIndex", "currentPayment"] as const;

/** Read a key from the flat body, accepting both `data[foo]` and bare `foo`. */
function pick(flat: Record<string, string>, ...names: readonly string[]): string | undefined {
  for (const n of names) {
    const v = flat[`data[${n}]`] ?? flat[n];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

/**
 * Flatten Grow's form-encoded body into a `GrowCallback`. Grow nests
 * everything under `data[...]` (custom fields nested again under
 * `data[customFields][...]`) — the same wrapper shape as its other responses.
 */
export function parseGrowCallback(flat: Record<string, string>): GrowCallback {
  return {
    err: pick(flat, "err"),
    status: pick(flat, "status"),
    statusCode: pick(flat, "statusCode"),
    transactionTypeId: pick(flat, "transactionTypeId"),
    paymentType: pick(flat, "paymentType"),
    paymentsNum: pick(flat, ...PAYMENTS_NUM_KEYS),
    currentPaymentNum: pick(flat, ...CURRENT_PAYMENT_KEYS),
    sum: pick(flat, "sum", "total_amount", "totalAmount"),
    paymentDate: pick(flat, "paymentDate"),
    description: pick(flat, "description", "productsDescription", "paymentDescription"),
    fullName: pick(flat, "fullName"),
    payerPhone: pick(flat, "payerPhone", "phone"),
    payerEmail: pick(flat, "payerEmail", "email"),
    processId: pick(flat, "processId"),
    processToken: pick(flat, "processToken"),
    transactionId: pick(flat, "transactionId"),
    transactionToken: pick(flat, "transactionToken"),
    asmachta: pick(flat, "asmachta"),
    cardSuffix: pick(flat, "cardSuffix"),
    cardBrand: pick(flat, "cardBrand"),
    cardToken: pick(flat, "cardToken"),
    invoiceUrl: pick(flat, "invoiceUrl"),
  };
}

/** Did this callback report a successful charge? */
export function isGrowSuccess(cb: GrowCallback): boolean {
  return cb.statusCode === "2" || cb.status === "1" || cb.status === "success";
}

/** Grow's unique id for a charge — our idempotency key. */
export function growExternalId(cb: GrowCallback): string | null {
  return cb.transactionId ?? cb.asmachta ?? cb.transactionToken ?? null;
}

/**
 * How many monthly payments the payer committed to — the number of months of
 * access this purchase buys. Missing or nonsense means a single month, which
 * under-grants rather than over-grants.
 */
export function growPayments(cb: GrowCallback): number {
  const n = Math.trunc(Number(cb.paymentsNum));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAYMENTS);
}

/** The amount of a single charge, ILS. */
export function growChargeIls(cb: GrowCallback): number | null {
  const n = Number(cb.sum);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Strip whitespace/punctuation noise so product names compare reliably. */
function normalize(s: string): string {
  return s.replace(/["'׳״]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Which plan this charge bought.
 *
 * The product name is authoritative: the Grow page sells exactly one named
 * product per plan, and it comes back in `description`. Amount matching is
 * only a fallback for when Grow sends no description, and deliberately
 * tolerant about VAT — we can't be certain whether the page reports the
 * charge gross or net, so a match either way still identifies the plan (the
 * amount we RECORD is always the real `sum`, never the catalog price).
 */
export function growPlan(cb: GrowCallback, catalog: Record<PlanId, Plan> = PLANS): PlanId | null {
  const description = normalize(cb.description ?? "");
  if (description) {
    for (const id of PAID_PLANS) {
      const product = normalize(catalog[id].growProductName || PLANS[id].growProductName);
      if (product && description.includes(product)) return id;
    }
  }

  const charge = growChargeIls(cb);
  if (charge === null) return null;
  for (const id of PAID_PLANS) {
    const price = catalog[id].priceIls;
    if (price <= 0) continue;
    for (const candidate of [price, price * (1 + VAT_RATE), price / (1 + VAT_RATE)]) {
      // 1% tolerance absorbs Grow's rounding of the VAT split.
      if (Math.abs(charge - candidate) <= Math.max(0.5, candidate * 0.01)) return id;
    }
  }
  return null;
}
