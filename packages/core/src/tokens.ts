import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Single-use tokens for invite links.
 *
 * The raw token is shown to the inviter once and never stored — only its
 * SHA-256 hash goes in the database, so a leaked backup cannot be replayed into
 * account creation. This mirrors how password reset tokens should be handled;
 * the token is high-entropy and single-use, so a plain hash (no salt/KDF) is
 * sufficient and keeps lookup a single indexed query.
 */

/** A fresh token: `raw` goes in the link, `hash` goes in the database. */
export function createToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time compare, so a token cannot be recovered by timing the lookup. */
export function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
