import "server-only";
import { cookies } from "next/headers";
import { loadEnv, signSession, verifySession, type SessionClaims } from "@kesher/core";

const COOKIE = "kesher_session";

export async function createSession(claims: SessionClaims): Promise<void> {
  const { JWT_SECRET } = loadEnv();
  const token = await signSession(claims, JWT_SECRET);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function getSession(): Promise<SessionClaims | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const { JWT_SECRET } = loadEnv();
  return verifySession(token, JWT_SECRET);
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
