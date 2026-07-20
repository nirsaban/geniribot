import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

/**
 * Singleton Prisma client. In dev, reuse across HMR reloads to avoid
 * exhausting connections.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Tenant-scoped client helper.
 *
 * Every domain query MUST be scoped to an organization. This helper makes the
 * tenant boundary explicit at the call site so a missing scope is obvious in
 * review rather than a silent cross-tenant leak. Extend as the app grows; for
 * now it exposes the org id and the raw client together.
 *
 *   const t = forOrg(orgId);
 *   await t.db.contact.findMany({ where: t.scope });
 */
export function forOrg(organizationId: string) {
  return {
    organizationId,
    db: prisma,
    /** Spread into any `where` on an org-owned table. */
    scope: { organizationId } as const,
  };
}

export type TenantContext = ReturnType<typeof forOrg>;

export { logActivity } from "./activity.js";
