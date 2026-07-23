export * from "./plans.js";

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
  pageCode: string;
  userId: string;
  apiKey?: string;
  sandbox?: boolean;
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
  cField1?: string; // organizationId
  cField2?: string; // plan
  cField3?: string; // interval
  [k: string]: string | undefined;
}

const GROW_PROD = "https://secure.meshulam.co.il/api/light/server/1.0";
const GROW_SANDBOX = "https://sandbox.meshulam.co.il/api/light/server/1.0";

/**
 * Grow (Meshulam) light-server provider. Creates a hosted recurring payment
 * process and returns its URL to redirect the tenant to. The webhook/callback
 * then activates the plan (see the web billing routes). The payment PAGE
 * (identified by `pageCode`) is where recurring/הוראת-קבע and the enabled
 * payment methods — card, Bit, Apple Pay, Google Pay — are configured in the
 * Grow dashboard; each successful charge fires our notifyUrl.
 * Docs: https://developers.grow.business — `createPaymentProcess`.
 */
export class GrowProvider implements PaymentProvider {
  readonly name = "grow";
  constructor(private readonly cfg: GrowConfig) {}

  private get base(): string {
    return this.cfg.sandbox ? GROW_SANDBOX : GROW_PROD;
  }

  private form(extra: Record<string, string>): URLSearchParams {
    const body = new URLSearchParams({
      pageCode: this.cfg.pageCode,
      userId: this.cfg.userId,
      ...extra,
    });
    if (this.cfg.apiKey) body.set("apiKey", this.cfg.apiKey);
    return body;
  }

  async createCheckout(input: CheckoutInput): Promise<{ url: string }> {
    const body = this.form({
      sum: String(input.sumIls),
      description: input.description,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      chargeType: "1",
      // Save the card token so recurring renewals can be charged without re-entry.
      saveCardToken: "1",
      // Custom fields echoed back on the callback for reconciliation.
      cField1: input.organizationId,
      cField2: input.plan,
      cField3: input.interval,
    });
    if (input.notifyUrl) body.set("notifyUrl", input.notifyUrl);
    if (input.notifyUrl) body.set("invoiceNotifyUrl", input.notifyUrl);
    if (input.payerName) body.set("pageField[fullName]", input.payerName);
    if (input.payerPhone) body.set("pageField[phone]", input.payerPhone);
    if (input.payerEmail) body.set("pageField[email]", input.payerEmail);

    const json = await this.post<{ data?: { url?: string; processId?: string; processToken?: string } }>(
      "createPaymentProcess",
      body,
    );
    if (!json.data?.url) throw new Error(`grow: no payment url in response`);
    return { url: json.data.url };
  }

  /**
   * Verify a callback out-of-band before trusting it. Grow's callback is
   * unauthenticated, so we re-fetch the process from Grow and confirm it
   * actually succeeded. Returns the authoritative transaction data or null.
   */
  async verifyTransaction(processId: string, processToken: string): Promise<GrowCallback | null> {
    try {
      const body = this.form({ processId, processToken });
      const json = await this.post<{ data?: GrowCallback | GrowCallback[] }>(
        "getPaymentProcessInfo",
        body,
      );
      const d = json.data;
      const row = Array.isArray(d) ? d[0] : d;
      if (!row) return null;
      const ok = row.statusCode === "2" || row.status === "1" || row.status === "success";
      return ok ? row : null;
    } catch {
      return null;
    }
  }

  /**
   * Acknowledge a successful transaction to Grow. Recommended after each
   * successful payment. Best-effort — the charge stands even if this fails.
   */
  async approveTransaction(cb: GrowCallback): Promise<void> {
    try {
      const body = this.form({
        transactionId: cb.transactionId ?? "",
        transactionToken: cb.transactionToken ?? "",
        transactionTypeId: cb.transactionTypeId ?? "",
        paymentType: cb.paymentType ?? "",
        sum: cb.sum ?? "",
        asmachta: cb.asmachta ?? "",
        processId: cb.processId ?? "",
        processToken: cb.processToken ?? "",
        fullName: cb.fullName ?? "",
        payerPhone: cb.payerPhone ?? "",
        payerEmail: cb.payerEmail ?? "",
        cardSuffix: cb.cardSuffix ?? "",
        cardBrand: cb.cardBrand ?? "",
      });
      await this.post("approveTransaction", body);
    } catch {
      /* best-effort ack */
    }
  }

  private async post<T>(path: string, body: URLSearchParams): Promise<T> {
    const res = await fetch(`${this.base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`grow ${path} ${res.status}`);
    const json = (await res.json()) as { status?: number; err?: unknown } & T;
    if (json.status !== 1) throw new Error(`grow ${path} error: ${JSON.stringify(json.err ?? json)}`);
    return json;
  }
}
