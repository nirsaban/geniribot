/** Plan catalog + limits. Mirrors the Prisma `Plan` enum. */

export type PlanId = "FREE" | "STARTER" | "PRO";

/** How a paid plan is billed. Annual = 2 months free vs. monthly. */
export type BillingInterval = "MONTHLY" | "ANNUAL";

export interface PlanLimits {
  connections: number;
  contacts: number;
  monthlyMessages: number;
}

export interface Plan {
  id: PlanId;
  name: string; // Hebrew display name
  /** Monthly price, ILS, **VAT (מע"מ) included**. */
  priceIls: number;
  /** Yearly price, ILS, VAT included. Set to 12×monthly − 2 months (2 months free). */
  annualIls: number;
  limits: PlanLimits;
  features: string[]; // Hebrew feature bullets
}

/** Displayed prices already include Israeli VAT (מע"מ). */
export const VAT_INCLUDED = true;

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: "FREE",
    name: "חינם",
    priceIls: 0,
    annualIls: 0,
    limits: { connections: 1, contacts: 100, monthlyMessages: 500 },
    features: ["מספר וואטסאפ אחד", "עד 100 לידים", "בוט וקביעת פגישות"],
  },
  STARTER: {
    id: "STARTER",
    name: "בסיסי",
    priceIls: 99,
    annualIls: 990, // 99 × 10 (2 months free)
    limits: { connections: 2, contacts: 2000, monthlyMessages: 5000 },
    features: ["2 מספרי וואטסאפ", "עד 2,000 לידים", "סנכרון יומן Google", "תזכורות אוטומטיות"],
  },
  PRO: {
    id: "PRO",
    name: "מקצועי",
    priceIls: 299,
    annualIls: 2990, // 299 × 10 (2 months free)
    limits: { connections: 10, contacts: 50000, monthlyMessages: 100000 },
    features: ["עד 10 מספרים", "עד 50,000 לידים", "כל היכולות", "תמיכה מועדפת"],
  },
};

export function planLimits(id: PlanId): PlanLimits {
  return PLANS[id].limits;
}

/** The charge amount (VAT-included ILS) for a plan at a given billing interval. */
export function planPrice(id: PlanId, interval: BillingInterval): number {
  return interval === "ANNUAL" ? PLANS[id].annualIls : PLANS[id].priceIls;
}

/** How many months a paid period covers, for computing the next renewal date. */
export function intervalMonths(interval: BillingInterval): number {
  return interval === "ANNUAL" ? 12 : 1;
}
