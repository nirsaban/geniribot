export * from "./plans.js";

import type { PlanId } from "./plans.js";

/**
 * Payment provider abstraction. Kesher bills tenants via **Grow** (Israeli
 * payments, formerly Meshulam) — not Stripe. The provider is used only when the
 * tenant has configured their Grow credentials; otherwise billing degrades to a
 * "contact us / not configured" state.
 */

export interface CheckoutInput {
  plan: PlanId;
  sumIls: number;
  description: string;
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
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

const GROW_PROD = "https://secure.meshulam.co.il/api/light/server/1.0";
const GROW_SANDBOX = "https://sandbox.meshulam.co.il/api/light/server/1.0";

/**
 * Grow (Meshulam) light-server provider. Creates a hosted payment process and
 * returns its URL to redirect the tenant to. The webhook/callback then activates
 * the plan (see the web billing routes). Docs: https://grow.business / Meshulam
 * light API `createPaymentProcess`.
 */
export class GrowProvider implements PaymentProvider {
  readonly name = "grow";
  constructor(private readonly cfg: GrowConfig) {}

  async createCheckout(input: CheckoutInput): Promise<{ url: string }> {
    const base = this.cfg.sandbox ? GROW_SANDBOX : GROW_PROD;
    const body = new URLSearchParams({
      pageCode: this.cfg.pageCode,
      userId: this.cfg.userId,
      sum: String(input.sumIls),
      description: input.description,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      chargeType: "1",
      cField1: input.organizationId,
      cField2: input.plan,
    });
    if (this.cfg.apiKey) body.set("apiKey", this.cfg.apiKey);

    const res = await fetch(`${base}/createPaymentProcess`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`grow createPaymentProcess ${res.status}`);
    const json = (await res.json()) as {
      status?: number;
      err?: unknown;
      data?: { url?: string };
    };
    if (json.status !== 1 || !json.data?.url) {
      throw new Error(`grow error: ${JSON.stringify(json.err ?? json)}`);
    }
    return { url: json.data.url };
  }
}
