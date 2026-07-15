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
