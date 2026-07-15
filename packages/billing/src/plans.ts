/** Plan catalog + limits. Mirrors the Prisma `Plan` enum. */

export type PlanId = "FREE" | "STARTER" | "PRO";

export interface PlanLimits {
  connections: number;
  contacts: number;
  monthlyMessages: number;
}

export interface Plan {
  id: PlanId;
  name: string; // Hebrew display name
  priceIls: number; // monthly, ILS
  limits: PlanLimits;
  features: string[]; // Hebrew feature bullets
}

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: "FREE",
    name: "חינם",
    priceIls: 0,
    limits: { connections: 1, contacts: 100, monthlyMessages: 500 },
    features: ["מספר וואטסאפ אחד", "עד 100 לידים", "בוט וקביעת פגישות"],
  },
  STARTER: {
    id: "STARTER",
    name: "בסיסי",
    priceIls: 99,
    limits: { connections: 2, contacts: 2000, monthlyMessages: 5000 },
    features: ["2 מספרי וואטסאפ", "עד 2,000 לידים", "סנכרון יומן Google", "תזכורות אוטומטיות"],
  },
  PRO: {
    id: "PRO",
    name: "מקצועי",
    priceIls: 299,
    limits: { connections: 10, contacts: 50000, monthlyMessages: 100000 },
    features: ["עד 10 מספרים", "עד 50,000 לידים", "כל היכולות", "תמיכה מועדפת"],
  },
};

export function planLimits(id: PlanId): PlanLimits {
  return PLANS[id].limits;
}
