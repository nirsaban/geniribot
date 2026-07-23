import "server-only";
import { GrowProvider, type GrowConfig } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { getSecret } from "./secrets";

/** The platform (super-admin) organization that owns the Grow credentials. */
export async function platformOrgId(): Promise<string | null> {
  const o = await prisma.organization.findUnique({
    where: { slug: "platform" },
    select: { id: true },
  });
  return o?.id ?? null;
}

/** Grow secret names as stored in the per-org Secret store. */
export const GROW_SECRETS = {
  pageCode: "grow_page_code",
  userId: "grow_user_id",
  apiKey: "grow_api_key",
} as const;

/** Build the tenant's Grow config from their pasted secrets, or null. */
export async function growConfigForOrg(org: string): Promise<GrowConfig | null> {
  const [pageCode, userId, apiKey] = await Promise.all([
    getSecret(org, GROW_SECRETS.pageCode),
    getSecret(org, GROW_SECRETS.userId),
    getSecret(org, GROW_SECRETS.apiKey),
  ]);
  if (!pageCode || !userId) return null;
  return {
    pageCode,
    userId,
    apiKey: apiKey ?? undefined,
    sandbox: process.env.GROW_SANDBOX === "1",
  };
}

export async function growProviderForOrg(org: string): Promise<GrowProvider | null> {
  const cfg = await growConfigForOrg(org);
  return cfg ? new GrowProvider(cfg) : null;
}

/** Grow provider using the PLATFORM credentials (set by the super admin). */
export async function growPlatformProvider(): Promise<GrowProvider | null> {
  const org = await platformOrgId();
  return org ? growProviderForOrg(org) : null;
}

export async function growPlatformConfigured(): Promise<boolean> {
  const org = await platformOrgId();
  return org ? Boolean(await growConfigForOrg(org)) : false;
}

/**
 * Fallback used until the super admin sets one in /admin (or the platform
 * org isn't provisioned yet, e.g. a fresh dev database).
 */
const DEFAULT_GROW_PAYMENT_URL =
  "https://pay.grow.link/MTAzNTk4~eed6c18dda5397dbf9505860c9b4d429-Mzc0Mjc0Mw";

/**
 * The static hosted Grow payment page (both paid plans, picked there) that
 * the landing page and the in-app plan picker link to when per-org API
 * checkout isn't configured. Super-admin editable in /admin.
 */
export async function growPaymentUrl(): Promise<string> {
  const org = await platformOrgId();
  if (!org) return DEFAULT_GROW_PAYMENT_URL;
  const row = await prisma.organization.findUnique({ where: { id: org }, select: { growPaymentUrl: true } });
  return row?.growPaymentUrl || DEFAULT_GROW_PAYMENT_URL;
}
