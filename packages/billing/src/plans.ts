/** Plan catalog + limits. Mirrors the Prisma `Plan` enum. */

export type PlanId = "FREE" | "STARTER" | "PRO";

export interface PlanLimits {
  connections: number;
  contacts: number;
  monthlyMessages: number;
  products: number;
}

export interface Plan {
  id: PlanId;
  name: string; // Hebrew display name
  /**
   * Monthly charge, ILS, **VAT (מע"מ) included**. This MUST equal the price of
   * this plan's product on the Grow payment page (see `growProductName`) —
   * it's both what we advertise and the fallback the callback is matched
   * against when Grow doesn't echo the product name back.
   */
  priceIls: number;
  /**
   * The product's name exactly as configured on the Grow payment page. The
   * payment callback carries it in `description`, and that's the primary way
   * `growPlan` decides which plan was bought. Empty for FREE (not sold).
   */
  growProductName: string;
  limits: PlanLimits;
  features: string[]; // Hebrew feature bullets
}

/** Displayed prices already include Israeli VAT (מע"מ). */
export const VAT_INCLUDED = true;

/**
 * How many monthly payments the Grow הוראת קבע can be set to, at most. Mirrors
 * `maxPaymentNum` on the payment link — keep the two in sync, since a payer
 * choosing 12 payments buys 12 months of access up front.
 */
export const MAX_PAYMENTS = 12;

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: "FREE",
    name: "חינם",
    priceIls: 0,
    growProductName: "",
    limits: { connections: 1, contacts: 100, monthlyMessages: 500, products: 1 },
    features: ["מספר וואטסאפ אחד", "עד 100 לידים", "בוט וקביעת פגישות"],
  },
  STARTER: {
    id: "STARTER",
    name: "בסיסי",
    priceIls: 49.56,
    growProductName: "מנוי מתקדם",
    limits: { connections: 2, contacts: 2000, monthlyMessages: 5000, products: 5 },
    features: ["2 מספרי וואטסאפ", "עד 2,000 לידים", "סנכרון יומן Google", "תזכורות אוטומטיות"],
  },
  PRO: {
    id: "PRO",
    name: "מקצועי",
    priceIls: 89,
    growProductName: "מנוי פרימיום",
    limits: { connections: 10, contacts: 50000, monthlyMessages: 100000, products: 50 },
    features: ["עד 10 מספרים", "עד 50,000 לידים", "כל היכולות", "תמיכה מועדפת"],
  },
};

/** The paid plans, cheapest first — FREE is chosen in-app, never bought. */
export const PAID_PLANS = ["STARTER", "PRO"] as const;
export type PaidPlanId = (typeof PAID_PLANS)[number];

/** `catalog` defaults to the static PLANS; pass the super-admin-configured one (see `loadPlanCatalog`) where it matters. */
export function planLimits(id: PlanId, catalog: Record<PlanId, Plan> = PLANS): PlanLimits {
  return catalog[id].limits;
}

/** The monthly charge amount (VAT-included ILS) for a plan. */
export function planPrice(id: PlanId, catalog: Record<PlanId, Plan> = PLANS): number {
  return catalog[id].priceIls;
}

/** Money for display: "49.56" but "89", never "89.00". */
export function formatIls(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}
