import "server-only";
import { decryptSecret, encryptSecret, loadEnv, secretsKey } from "@kesher/core";
import { oauthClient, type GoogleOAuthConfig } from "@kesher/calendar";

/** True when Google OAuth env is configured (otherwise the feature is hidden). */
export function googleConfigured(): boolean {
  const e = loadEnv();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REDIRECT_URI);
}

export function googleConfig(): GoogleOAuthConfig {
  const e = loadEnv();
  return {
    clientId: e.GOOGLE_CLIENT_ID!,
    clientSecret: e.GOOGLE_CLIENT_SECRET!,
    redirectUri: e.GOOGLE_REDIRECT_URI!,
  };
}

export function googleClient() {
  return oauthClient(googleConfig());
}

function key(): Buffer {
  const e = loadEnv();
  return secretsKey(e.SECRETS_KEY, e.JWT_SECRET);
}

export function encToken(plain: string): string {
  return encryptSecret(plain, key());
}

export function decToken(blob: string): string {
  return decryptSecret(blob, key());
}
