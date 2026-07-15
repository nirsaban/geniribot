"use server";

import { redirect } from "next/navigation";
import { hashPassword, verifyPassword } from "@kesher/core";
import { prisma } from "@kesher/db";
import { createSession } from "@/lib/session";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^\w֐-׿]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "org") + "-" + Math.random().toString(36).slice(2, 7);
}

export async function registerAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const orgName = String(formData.get("orgName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!email || password.length < 6 || !orgName) {
    return { error: "מלא/י את כל השדות (סיסמה 6+ תווים)" };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "emailTaken" };

  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: orgName, slug: slugify(orgName) },
    });
    return tx.user.create({
      data: { email, passwordHash, name: name || null, role: "OWNER", organizationId: org.id },
    });
  });

  await createSession({ sub: user.id, org: user.organizationId, role: "OWNER" });
  redirect("/dashboard/onboarding");
}

export async function loginAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    return { error: "authError" };
  }

  await createSession({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
    sa: user.isSuperAdmin,
  });
  redirect(user.isSuperAdmin ? "/admin" : "/dashboard");
}
