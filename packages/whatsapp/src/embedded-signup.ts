/**
 * WhatsApp Embedded Signup — server-side helpers (direct-to-Meta, no BSP).
 *
 * Embedded Signup runs in the browser (Facebook JS SDK + FB.login) and returns
 * three things to our page: the customer's `waba_id`, `phone_number_id`, and an
 * OAuth **code**. These helpers run the server half of the exchange:
 *
 *   1. exchangeCode      code               → long-lived business access token
 *   2. registerPhone     phone_number_id    → register the number for Cloud API
 *   3. subscribeApp      waba_id            → subscribe OUR app to the WABA (webhooks)
 *   4. getDisplayNumber  phone_number_id    → human-readable +9725… for the UI
 *
 * All calls hit the Meta Graph API and are `fetch`-injectable so they unit-test
 * without a live Meta account (mirrors CloudApiProvider's constructor-injected fetch).
 */

const GRAPH = "https://graph.facebook.com";
const DEFAULT_VERSION = "v21.0";

export interface EmbeddedSignupConfig {
  appId: string;
  appSecret: string;
  apiVersion?: string;
}

export interface EmbeddedSignupClient {
  /** Meta returns "already registered" style errors we treat as success. */
  registerAlreadyDoneCodes?: number[];
}

/** Graph error shape (a subset — enough to classify). */
interface GraphError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

async function graphJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { _raw: text };
  }
  return json;
}

function graphErr(prefix: string, status: number, json: Record<string, unknown>): Error {
  const e = (json as GraphError).error;
  const msg = e?.message ?? JSON.stringify(json);
  return new Error(`${prefix} ${status}: ${msg}`);
}

/**
 * Exchange the Embedded Signup OAuth `code` for the customer's business access
 * token. Uses the app id/secret (server-side only — never expose the secret).
 */
export async function exchangeCode(
  code: string,
  cfg: EmbeddedSignupConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const v = cfg.apiVersion ?? DEFAULT_VERSION;
  const url = new URL(`${GRAPH}/${v}/oauth/access_token`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("code", code);
  const res = await fetchImpl(url.toString(), { method: "GET" });
  const json = await graphJson(res);
  if (!res.ok) throw graphErr("embedded_signup exchangeCode", res.status, json);
  const token = json.access_token;
  if (typeof token !== "string" || !token) {
    throw new Error("embedded_signup exchangeCode: no access_token in response");
  }
  return token;
}

/**
 * Register the customer's phone number for Cloud API with a 6-digit 2FA PIN.
 * If the number is already registered, Meta errors — we treat the known
 * "already registered" subcode as success (idempotent re-onboarding).
 */
export async function registerPhone(
  phoneNumberId: string,
  accessToken: string,
  pin: string,
  cfg: Pick<EmbeddedSignupConfig, "apiVersion">,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const v = cfg.apiVersion ?? DEFAULT_VERSION;
  const res = await fetchImpl(`${GRAPH}/${v}/${phoneNumberId}/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
  if (res.ok) return;
  const json = await graphJson(res);
  // 139001 = number already registered / already using two-step; treat as ok.
  const sub = (json as GraphError).error?.error_subcode;
  const codeMatchesAlready = sub === 139001;
  const msg = (json as GraphError).error?.message ?? "";
  if (codeMatchesAlready || /already/i.test(msg)) return;
  throw graphErr("embedded_signup registerPhone", res.status, json);
}

/**
 * Subscribe OUR app to the customer's WABA so their inbound messages are
 * delivered to our (app-level) webhook.
 */
export async function subscribeApp(
  wabaId: string,
  accessToken: string,
  cfg: Pick<EmbeddedSignupConfig, "apiVersion">,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const v = cfg.apiVersion ?? DEFAULT_VERSION;
  const res = await fetchImpl(`${GRAPH}/${v}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (res.ok) return;
  throw graphErr("embedded_signup subscribeApp", res.status, await graphJson(res));
}

/** Fetch the display phone number (e.g. "+972 50-123-4567") for the UI. */
export async function getDisplayNumber(
  phoneNumberId: string,
  accessToken: string,
  cfg: Pick<EmbeddedSignupConfig, "apiVersion">,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const v = cfg.apiVersion ?? DEFAULT_VERSION;
  const res = await fetchImpl(
    `${GRAPH}/${v}/${phoneNumberId}?fields=display_phone_number,verified_name`,
    { method: "GET", headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null; // best-effort — UI can fall back to the phone-number id
  const json = await graphJson(res);
  const num = json.display_phone_number;
  return typeof num === "string" ? num : null;
}

export interface OnboardResult {
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
  displayPhoneNumber: string | null;
}

/**
 * Full server-side onboarding: exchange → register → subscribe → fetch number.
 * Returns everything the caller needs to persist a `cloud_api` connection.
 * `pin` is the number's 2FA PIN (generate/store it per connection).
 */
export async function completeEmbeddedSignup(
  input: { code: string; phoneNumberId: string; wabaId: string; pin: string },
  cfg: EmbeddedSignupConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<OnboardResult> {
  const accessToken = await exchangeCode(input.code, cfg, fetchImpl);
  await registerPhone(input.phoneNumberId, accessToken, input.pin, cfg, fetchImpl);
  await subscribeApp(input.wabaId, accessToken, cfg, fetchImpl);
  const displayPhoneNumber = await getDisplayNumber(
    input.phoneNumberId,
    accessToken,
    cfg,
    fetchImpl,
  );
  return {
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    accessToken,
    displayPhoneNumber,
  };
}
