export * from "./plans.js";
export * from "./features.js";
export * from "./status.js";
export * from "./catalog.js";

import type { BillingInterval, PlanId } from "./plans.js";

/**
 * Payment provider abstraction. GeniriBot bills tenants via **Grow** (Israeli
 * payments, formerly Meshulam) — not Stripe. The provider is used only when the
 * platform has configured its Grow credentials; otherwise billing degrades to a
 * "contact us / not configured" state.
 */

export interface CheckoutInput {
  plan: PlanId;
  interval: BillingInterval;
  sumIls: number;
  description: string;
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
  /** Server-to-server callback Grow POSTs on payment (and each recurring charge). */
  notifyUrl?: string;
  /** Prefill the payer's details on the Grow page when known. */
  payerName?: string;
  payerPhone?: string;
  payerEmail?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
}

export interface GrowConfig {
  /** Make.com "Custom webhook" URL wrapping Grow's createPaymentProcess. */
  createCheckoutWebhookUrl: string;
  /** Make.com webhook wrapping Grow's getPaymentProcessInfo + approveTransaction. */
  verifyWebhookUrl: string;
  /** Make.com webhook wrapping Grow's createTransactionWithToken. Only needed for chargeToken(). */
  chargeTokenWebhookUrl?: string;
}

/** Fields Grow POSTs to the notifyUrl callback (subset we use). Form-encoded. */
export interface GrowCallback {
  transactionId?: string;
  transactionToken?: string;
  asmachta?: string;
  processId?: string;
  processToken?: string;
  sum?: string;
  status?: string;
  statusCode?: string;
  cardSuffix?: string;
  cardBrand?: string;
  cardType?: string;
  transactionTypeId?: string;
  paymentType?: string;
  fullName?: string;
  payerPhone?: string;
  payerEmail?: string;
  invoiceUrl?: string;
  /** The saved-card token (from `saveCardToken: "1"`), for later chargeToken() calls. */
  cardToken?: string;
  cField1?: string; // organizationId
  cField2?: string; // plan
  cField3?: string; // interval
  [k: string]: string | undefined;
}

export interface ChargeTokenInput {
  cardToken: string;
  sumIls: number;
  description: string;
  /** Idempotency key — must be unique per charge attempt. */
  uniqueIdentifier: string;
  payerName: string;
  payerPhone: string;
  payerEmail?: string;
  organizationId?: string;
}

/**
 * Grow (Meshulam) light-server provider. Every call is proxied through a
 * Make.com scenario (Custom webhook -> Grow "Make an API Call" module, using
 * the Grow connection authenticated in Make via account number + phone -> Webhook
 * response relaying Grow's raw JSON) instead of calling secure.meshulam.co.il
 * directly. See the Make scenario recipes in the billing README for the exact
 * module wiring each webhook URL below is expected to perform.
 *
 * createCheckout returns a hosted payment page URL to redirect to (or embed in
 * an iframe — Grow explicitly supports both). Its webhook/callback then
 * activates the plan (see the web billing routes). chargeToken() charges a
 * previously saved card token directly, no page/link shown to the customer —
 * requires Grow to have granted the merchant account permission for
 * createTransactionWithToken.
 */
export class GrowProvider implements PaymentProvider {
  readonly name = "grow";
  constructor(private readonly cfg: GrowConfig) {}

  async createCheckout(input: CheckoutInput): Promise<{ url: string }> {
    const json = await this.call<{ data?: { url?: string; processId?: string; processToken?: string } }>(
      this.cfg.createCheckoutWebhookUrl,
      {
        sumIls: input.sumIls,
        description: input.description,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        // Save the card token so recurring renewals (and later chargeToken calls)
        // can charge without re-entry.
        saveCardToken: true,
        organizationId: input.organizationId,
        plan: input.plan,
        interval: input.interval,
        notifyUrl: input.notifyUrl,
        payerName: input.payerName,
        payerPhone: input.payerPhone,
        payerEmail: input.payerEmail,
      },
    );
    if (!json.data?.url) throw new Error(`grow (via make): no payment url in response`);
    return { url: json.data.url };
  }

  /**
   * Verify a callback out-of-band before trusting it. Grow's callback is
   * unauthenticated, so we re-fetch the process from Grow and confirm it
   * actually succeeded. Returns the authoritative transaction data or null.
   * The backing Make scenario also acks the transaction with Grow's
   * `approveTransaction` internally — no separate approve call needed.
   *
   * transactionId/transactionToken identify the specific charge to approve;
   * Grow's own notify callback already carries them, so we pass them straight
   * through rather than re-deriving them from getPaymentProcessInfo (whose
   * `paymentLinkTransactions` list comes back empty for payment-link-family
   * transactions).
   */
  async verifyTransaction(
    processId: string,
    processToken: string,
    transactionId?: string,
    transactionToken?: string,
  ): Promise<GrowCallback | null> {
    try {
      const json = await this.call<{ data?: GrowCallback | GrowCallback[] }>(this.cfg.verifyWebhookUrl, {
        processId,
        processToken,
        transactionId,
        transactionToken,
      });
      const row = Array.isArray(json.data) ? json.data[0] : json.data;
      if (!row) return null;
      const ok = row.statusCode === "2" || row.status === "1" || row.status === "success";
      return ok ? row : null;
    } catch {
      return null;
    }
  }

  /**
   * Charge a previously-saved card token directly — no payment page/link
   * shown to the customer. Do NOT call approveTransaction afterward (Grow's
   * docs: token transactions are acked implicitly).
   */
  async chargeToken(input: ChargeTokenInput): Promise<{ transactionId?: string }> {
    if (!this.cfg.chargeTokenWebhookUrl) throw new Error("grow: chargeToken webhook not configured");
    const json = await this.call<{ data?: { transactionId?: string } }>(this.cfg.chargeTokenWebhookUrl, {
      cardToken: input.cardToken,
      sum: input.sumIls,
      description: input.description,
      paymentType: 2, // Regular — a single one-off charge, not a recurring/installment plan.
      transactionUniqueIdentifier: input.uniqueIdentifier,
      payerName: input.payerName,
      payerPhone: input.payerPhone,
      payerEmail: input.payerEmail,
      cField1: input.organizationId,
    });
    return { transactionId: json.data?.transactionId };
  }

  private async call<T>(webhookUrl: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`grow-via-make ${webhookUrl} ${res.status}`);
    const json = (await res.json()) as { status?: number; err?: unknown } & T;
    if (json.status !== undefined && json.status !== 1) {
      throw new Error(`grow-via-make error: ${JSON.stringify(json.err ?? json)}`);
    }
    return json;
  }
}
