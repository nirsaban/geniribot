import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for secrets at rest (OAuth tokens, etc.) using
 * AES-256-GCM. Blob layout (base64): iv(12) | authTag(16) | ciphertext.
 */

/** Resolve a 32-byte key from base64 SECRETS_KEY, else derive from a fallback. */
export function secretsKey(rawBase64?: string, fallback?: string): Buffer {
  if (rawBase64) {
    const b = Buffer.from(rawBase64, "base64");
    if (b.length === 32) return b;
  }
  return createHash("sha256")
    .update(fallback ?? "kesher-dev-secret")
    .digest();
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
