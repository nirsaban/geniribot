/** Plan-gated capabilities beyond the numeric limits in `PlanLimits`. */

import type { PlanId } from "./plans.js";

export type Feature = "calendarSync" | "followups" | "broadcasts" | "groups";

const PLAN_FEATURES: Record<PlanId, ReadonlySet<Feature>> = {
  FREE: new Set([]),
  STARTER: new Set<Feature>(["calendarSync", "followups"]),
  PRO: new Set<Feature>(["calendarSync", "followups", "broadcasts", "groups"]),
};

export function planHasFeature(id: PlanId, feature: Feature): boolean {
  return PLAN_FEATURES[id].has(feature);
}
