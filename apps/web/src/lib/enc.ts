import "server-only";
import { encryptSecret, loadEnv, secretsKey } from "@kesher/core";

function key(): Buffer {
  const e = loadEnv();
  return secretsKey(e.SECRETS_KEY, e.JWT_SECRET);
}

/** Encrypt a value for storage in a JSON blob (e.g. connection.authState). */
export function encField(plain: string): string {
  return encryptSecret(plain, key());
}
