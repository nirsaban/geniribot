"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createToken,
  hasRole,
  hashPassword,
  hashToken,
  isRealEmail,
  mailConfigured,
  sendMail,
  type Role,
} from "@kesher/core";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { createSession, getSession } from "@/lib/session";

const INVITE_TTL_DAYS = 7;

async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Team management is ADMIN+.
 *
 * Enforced here rather than only in the UI: a server action is a public
 * endpoint, so hiding the button is presentation, not authorization.
 */
async function requireAdmin() {
  const session = await requireSession();
  if (!hasRole(session.role as Role, "ADMIN")) redirect("/dashboard");
  return session;
}

function isRole(v: string): v is Role {
  return v === "OWNER" || v === "ADMIN" || v === "AGENT";
}

function baseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "https://wabot.miltech.cloud";
}

export interface InviteResult {
  link?: string;
  emailed?: boolean;
  error?: string;
}

/**
 * Create a single-use invite and return its link.
 *
 * The raw token is returned to the caller exactly once — only its hash is
 * stored — so the link must be surfaced now or regenerated later.
 */
export async function createInviteAction(
  _prev: InviteResult | null,
  formData: FormData,
): Promise<InviteResult> {
  const session = await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleRaw = String(formData.get("role") ?? "AGENT");
  const role: Role = isRole(roleRaw) ? roleRaw : "AGENT";

  // Only an owner may mint another owner — an admin escalating themselves via
  // an invite they accept from a second address would otherwise be trivial.
  if (role === "OWNER" && session.role !== "OWNER") {
    return { error: he.onlyOwnerCan };
  }
  if (email && !isRealEmail(email)) return { error: he.inviteEmailTaken };
  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return { error: he.inviteEmailTaken };
  }

  const { raw, hash } = createToken();
  await prisma.invite.create({
    data: {
      organizationId: session.org,
      email: email || null,
      role,
      tokenHash: hash,
      invitedById: session.sub,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  const link = `${baseUrl()}/invite/${raw}`;
  let emailed = false;
  if (email && mailConfigured()) {
    const org = await prisma.organization.findUnique({
      where: { id: session.org },
      select: { name: true },
    });
    const res = await sendMail({
      to: email,
      subject: `${he.appName} — ${he.inviteTitle}`,
      text: `הוזמנת להצטרף לצוות של ${org?.name ?? he.appName}.\n\nלהצטרפות: ${link}\n\nהקישור תקף ל־${INVITE_TTL_DAYS} ימים.`,
    });
    emailed = res.ok;
  }

  revalidatePath("/dashboard/team");
  return { link, emailed };
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  await prisma.invite.deleteMany({ where: { id, organizationId: session.org } });
  revalidatePath("/dashboard/team");
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  if (!isRole(roleRaw)) return;

  const member = await prisma.user.findFirst({
    where: { id: userId, organizationId: session.org },
  });
  if (!member) return;

  // Only an owner may grant or revoke ownership.
  if ((roleRaw === "OWNER" || member.role === "OWNER") && session.role !== "OWNER") return;
  // Never leave the organization without an owner — it would become unbillable
  // and unadministrable, with no path back short of database surgery.
  if (member.role === "OWNER" && roleRaw !== "OWNER") {
    const owners = await prisma.user.count({
      where: { organizationId: session.org, role: "OWNER" },
    });
    if (owners <= 1) return;
  }

  await prisma.user.update({ where: { id: member.id }, data: { role: roleRaw } });
  revalidatePath("/dashboard/team");
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (userId === session.sub) return; // cannot remove yourself

  const member = await prisma.user.findFirst({
    where: { id: userId, organizationId: session.org },
  });
  if (!member) return;
  if (member.role === "OWNER" && session.role !== "OWNER") return;
  if (member.role === "OWNER") {
    const owners = await prisma.user.count({
      where: { organizationId: session.org, role: "OWNER" },
    });
    if (owners <= 1) return;
  }

  // Their leads stay with the organization and fall back to unassigned —
  // `Contact.ownerUserId` is onDelete: SetNull.
  await prisma.user.delete({ where: { id: member.id } });
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/leads");
}

/** Accept an invite: create the user, sign them in, land them on the dashboard. */
export async function acceptInviteAction(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!isRealEmail(email)) return { error: he.inviteEmailTaken };
  if (password.length < 6) return { error: he.passwordTooShort };

  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || invite.acceptedAt) return { error: he.inviteInvalid };
  if (invite.expiresAt.getTime() < Date.now()) return { error: he.inviteExpired };
  // A targeted invite may only be accepted by the address it was sent to.
  if (invite.email && invite.email !== email) return { error: he.inviteInvalid };

  const taken = await prisma.user.findUnique({ where: { email } });
  if (taken) return { error: he.inviteEmailTaken };

  const user = await prisma.$transaction(async (tx) => {
    // Consume the invite in the same transaction as the account creation, so a
    // double submit cannot mint two users from one invite.
    const consumed = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (consumed.count === 0) throw new Error("already_accepted");

    return tx.user.create({
      data: {
        organizationId: invite.organizationId,
        email,
        name: name || null,
        passwordHash: await hashPassword(password),
        role: invite.role,
      },
    });
  });

  await createSession({ sub: user.id, org: user.organizationId, role: user.role });
  redirect("/dashboard");
}
