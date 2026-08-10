import { PLANS, type Plan, type PlanId } from "./plans.js";

/** Super-admin-editable fields. Name/features stay static — copy, not billing config. */
export interface PlanOverride {
  /**
   * Monthly VAT-included price. Must track the plan's product price on the
   * Grow payment page — the callback falls back to matching on it.
   */
  priceIls: number;
  connections: number;
  contacts: number;
  monthlyMessages: number;
  products: number;
}

/** Merge super-admin overrides onto the static defaults (a plan with no row keeps its default). */
export function mergePlans(overrides: Partial<Record<PlanId, PlanOverride>>): Record<PlanId, Plan> {
  const merged = {} as Record<PlanId, Plan>;
  for (const id of Object.keys(PLANS) as PlanId[]) {
    const base = PLANS[id];
    const o = overrides[id];
    merged[id] = o
      ? {
          ...base,
          priceIls: o.priceIls,
          limits: {
            connections: o.connections,
            contacts: o.contacts,
            monthlyMessages: o.monthlyMessages,
            products: o.products,
          },
        }
      : base;
  }
  return merged;
}

/**
 * Minimal shape needed to load overrides — avoids a hard `@prisma/client`
 * dependency in this package. `priceIls` is a DB decimal, so it arrives as
 * something number-ish rather than a `number`.
 */
export interface PlanConfigSource {
  planConfig: {
    findMany(): Promise<Array<{ id: PlanId; priceIls: unknown } & Omit<PlanOverride, "priceIls">>>;
  };
}

/** Read the live plan catalog: static defaults with any super-admin overrides applied. */
export async function loadPlanCatalog(db: PlanConfigSource): Promise<Record<PlanId, Plan>> {
  const rows = await db.planConfig.findMany();
  const overrides = Object.fromEntries(
    rows.map((r) => [r.id, { ...r, priceIls: Number(r.priceIls) }]),
  ) as Partial<Record<PlanId, PlanOverride>>;
  return mergePlans(overrides);
}
