import "server-only";
import { prisma } from "@kesher/db";

/** The platform (super-admin) organization that owns the Grow payment link. */
export async function platformOrgId(): Promise<string | null> {
  const o = await prisma.organization.findUnique({
    where: { slug: "platform" },
    select: { id: true },
  });
  return o?.id ?? null;
}

/**
 * The live GeniriBot payment page. Used when the platform org has no link
 * configured yet, so a fresh install still sells; the super admin can point
 * /admin at a different page at any time.
 */
export const DEFAULT_GROW_PAYMENT_URL =
  "https://pay.grow.link/MTAzNTk4~ff8a7093f30cddeb71cb84e4cbdb003e-MzgxNzY5Nw";

/**
 * THE Grow payment page — one link, both plans, sold as a הוראת קבע of 1–12
 * monthly payments. It is deliberately NOT parameterised per org or per plan:
 * the payer picks their product and length on Grow's page, and the callback
 * is what tells us who bought what (see `applyGrowPayment`).
 */
export async function growPaymentUrl(): Promise<string> {
  const org = await platformOrgId();
  const row = org
    ? await prisma.organization.findUnique({
        where: { id: org },
        select: { growPaymentUrl: true },
      })
    : null;
  return row?.growPaymentUrl?.trim() || DEFAULT_GROW_PAYMENT_URL;
}
