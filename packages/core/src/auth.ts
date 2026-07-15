import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

/** Roles mirror the Prisma `Role` enum. */
export type Role = "OWNER" | "ADMIN" | "AGENT";

/** Claims we embed in the session JWT. */
export interface SessionClaims {
  sub: string; // userId
  org: string; // organizationId
  role: Role;
}

const ALG = "HS256";
const DEFAULT_TTL = "7d";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// ---------- Passwords (argon2id) ----------
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

// ---------- Session tokens (jose JWT) ----------
export async function signSession(
  claims: SessionClaims,
  secret: string,
  ttl: string = DEFAULT_TTL,
): Promise<string> {
  return new SignJWT({ org: claims.org, role: claims.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALG] });
    if (
      typeof payload.sub === "string" &&
      typeof payload.org === "string" &&
      typeof payload.role === "string"
    ) {
      return { sub: payload.sub, org: payload.org, role: payload.role as Role };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------- RBAC ----------
const RANK: Record<Role, number> = { AGENT: 1, ADMIN: 2, OWNER: 3 };

/** True if `role` is at least as privileged as `required`. */
export function hasRole(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required];
}
