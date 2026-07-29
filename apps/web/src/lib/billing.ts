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

/** Grow-via-Make webhook URLs, as stored in the per-org Secret store. */
export const GROW_SECRETS = {
  createCheckoutWebhookUrl: "grow_make_create_checkout_webhook_url",
  /** Wraps Grow's getPaymentProcessInfo + approveTransaction in one scenario. */
  verifyWebhookUrl: "grow_make_verify_webhook_url",
  chargeTokenWebhookUrl: "grow_make_charge_token_webhook_url",
} as const;

/** Build the tenant's Grow-via-Make config from their pasted webhook URLs, or null. */
export async function growConfigForOrg(org: string): Promise<GrowConfig | null> {
  const [createCheckoutWebhookUrl, verifyWebhookUrl, chargeTokenWebhookUrl] = await Promise.all([
    getSecret(org, GROW_SECRETS.createCheckoutWebhookUrl),
    getSecret(org, GROW_SECRETS.verifyWebhookUrl),
    getSecret(org, GROW_SECRETS.chargeTokenWebhookUrl),
  ]);
  if (!createCheckoutWebhookUrl || !verifyWebhookUrl) return null;
  return {
    createCheckoutWebhookUrl,
    verifyWebhookUrl,
    chargeTokenWebhookUrl: chargeTokenWebhookUrl ?? undefined,
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
