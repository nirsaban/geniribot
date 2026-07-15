import "server-only";
import { decryptSecret, encryptSecret, loadEnv, secretsKey } from "@kesher/core";
import { prisma } from "@kesher/db";

/**
 * Per-tenant secure secrets (e.g. Grow payment keys). Stored AES-256-GCM
 * encrypted; plaintext never leaves the server. The UI only ever shows a masked
 * hint (last 4 chars).
 */
function key(): Buffer {
  const e = loadEnv();
  return secretsKey(e.SECRETS_KEY, e.JWT_SECRET);
}

export async function setSecret(org: string, name: string, value: string): Promise<void> {
  const valueEnc = encryptSecret(value, key());
  await prisma.secret.upsert({
    where: { organizationId_name: { organizationId: org, name } },
    update: { valueEnc },
    create: { organizationId: org, name, valueEnc },
  });
}

export async function getSecret(org: string, name: string): Promise<string | null> {
  const s = await prisma.secret.findUnique({
    where: { organizationId_name: { organizationId: org, name } },
  });
  if (!s) return null;
  try {
    return decryptSecret(s.valueEnc, key());
  } catch {
    return null;
  }
}

export async function deleteSecret(org: string, name: string): Promise<void> {
  await prisma.secret.deleteMany({ where: { organizationId: org, name } });
}

/** Masked hint for the UI — never the real value. */
export async function secretMask(org: string, name: string): Promise<string | null> {
  const v = await getSecret(org, name);
  if (!v) return null;
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
}
