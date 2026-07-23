import type { PlanId } from "./plans.js";

/** Just enough of a `Subscription` row to decide if it's still in good standing. */
export interface SubscriptionStanding {
  status: string; // SubscriptionStatus enum value
  currentPeriodEnd: Date | null;
}

/**
 * The plan actually in effect given a (possibly stale) `Organization.plan`
 * and its subscription row. `Organization.plan` only ever moves forward on a
 * successful Grow webhook — nothing rolls it back when a subscription lapses
 * (cancelled, or a renewal charge failed), so every plan-gated check must go
 * through this rather than trusting the denormalized field directly.
 */
export function effectivePlan(plan: PlanId, subscription: SubscriptionStanding | null): PlanId {
  if (plan === "FREE") return "FREE";
  const active = subscription?.status === "ACTIVE" || subscription?.status === "TRIALING";
  const expired = subscription?.currentPeriodEnd != null && subscription.currentPeriodEnd < new Date();
  return active && !expired ? plan : "FREE";
}
