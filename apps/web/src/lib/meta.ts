import "server-only";
import { platformOrgId } from "./billing";
import { getSecret } from "./secrets";

/**
 * Meta (Facebook) app config for WhatsApp Embedded Signup — direct-to-Meta.
 *
 * Like Grow, these live as **platform-org Secrets** (super-admin pastes them in
 * /admin) with an env-var fallback for local dev. The app id / config id are
 * safe to expose to the browser (needed by FB.login); the app secret + webhook
 * verify token are server-only.
 */

export const META_SECRETS = {
  appId: "meta_app_id",
  appSecret: "meta_app_secret",
  configId: "meta_config_id",
  webhookVerifyToken: "meta_webhook_verify_token",
  graphVersion: "meta_graph_version",
} as const;

const DEFAULT_VERSION = "v21.0";

async function readMeta(name: keyof typeof META_SECRETS, envKey: string): Promise<string | null> {
  const org = await platformOrgId();
  if (org) {
    const v = await getSecret(org, META_SECRETS[name]);
    if (v) return v;
  }
  return process.env[envKey] ?? null;
}

export async function metaGraphVersion(): Promise<string> {
  return (await readMeta("graphVersion", "META_GRAPH_VERSION")) ?? DEFAULT_VERSION;
}

/** Browser-safe config for the Embedded Signup button. Null if not configured. */
export async function metaPublicConfig(): Promise<{
  appId: string;
  configId: string;
  graphVersion: string;
} | null> {
  const [appId, configId, graphVersion] = await Promise.all([
    readMeta("appId", "META_APP_ID"),
    readMeta("configId", "META_CONFIG_ID"),
    metaGraphVersion(),
  ]);
  if (!appId || !configId) return null;
  return { appId, configId, graphVersion };
}

/** Server-only config for the token exchange (includes the app secret). */
export async function metaServerConfig(): Promise<{
  appId: string;
  appSecret: string;
  apiVersion: string;
} | null> {
  const [appId, appSecret, apiVersion] = await Promise.all([
    readMeta("appId", "META_APP_ID"),
    readMeta("appSecret", "META_APP_SECRET"),
    metaGraphVersion(),
  ]);
  if (!appId || !appSecret) return null;
  return { appId, appSecret, apiVersion };
}

export async function metaWebhookVerifyToken(): Promise<string | null> {
  return readMeta("webhookVerifyToken", "META_WEBHOOK_VERIFY_TOKEN");
}

export async function metaAppSecret(): Promise<string | null> {
  return readMeta("appSecret", "META_APP_SECRET");
}
