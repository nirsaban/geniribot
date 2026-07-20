"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasRole, type Role } from "@kesher/core";
import { logActivity, prisma, type LeadStatus } from "@kesher/db";
import { getSession } from "@/lib/session";
import { LEAD_STATUSES, leadVisibility } from "@/lib/leads";

async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Load a lead the caller is allowed to act on.
 *
 * Every action funnels through this: the id arrives from a form field the
 * client controls, so without the org filter one tenant could mutate another's
 * leads by guessing a cuid — and without the visibility filter an agent could
 * mutate a colleague's lead the same way, since the list hiding it is only
 * presentation.
 */
async function ownLead(session: { org: string; sub: string; role: string }, id: string) {
  const visibility = leadVisibility({ userId: session.sub, role: session.role as Role });
  const c = await prisma.contact.findFirst({
    where: { id, organizationId: session.org, ...(visibility ?? {}) },
  });
  if (!c) redirect("/dashboard/leads");
  return c;
}

/**
 * An agent may claim an unassigned lead or release one, but not reassign it to
 * a colleague — that is a manager's decision.
 */
function mayAssignTo(session: { sub: string; role: string }, ownerUserId: string | null): boolean {
  if (hasRole(session.role as Role, "ADMIN")) return true;
  return ownerUserId === null || ownerUserId === session.sub;
}

function refresh(id: string): void {
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${id}`);
}

function isLeadStatus(v: string): v is LeadStatus {
  return (LEAD_STATUSES as string[]).includes(v);
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!isLeadStatus(status)) return;

  const lead = await ownLead(session, id);
  if (lead.status === status) return;

  await prisma.contact.update({ where: { id: lead.id }, data: { status } });
  await logActivity({
    organizationId: session.org,
    contactId: lead.id,
    userId: session.sub,
    kind: "STATUS_CHANGED",
    fromValue: lead.status,
    toValue: status,
  });
  refresh(lead.id);
}

export async function assignOwnerAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("ownerUserId") ?? "");
  const ownerUserId = raw === "" ? null : raw;

  const lead = await ownLead(session, id);
  if (lead.ownerUserId === ownerUserId) return;
  if (!mayAssignTo(session, ownerUserId)) return;

  // A lead may only be assigned to someone in the same organization.
  if (ownerUserId) {
    const member = await prisma.user.findFirst({
      where: { id: ownerUserId, organizationId: session.org },
      select: { id: true },
    });
    if (!member) return;
  }

  await prisma.contact.update({ where: { id: lead.id }, data: { ownerUserId } });
  await logActivity({
    organizationId: session.org,
    contactId: lead.id,
    userId: session.sub,
    kind: "OWNER_ASSIGNED",
    fromValue: lead.ownerUserId,
    toValue: ownerUserId,
  });
  refresh(lead.id);
}

/** The post-call summary the agent types in — never generated. */
export async function saveSummaryAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const summary = String(formData.get("callSummary") ?? "").trim();

  const lead = await ownLead(session, id);
  if (lead.callSummary === (summary || null)) return;

  await prisma.contact.update({
    where: { id: lead.id },
    data: {
      callSummary: summary || null,
      callSummaryAt: summary ? new Date() : null,
      callSummaryById: summary ? session.sub : null,
    },
  });
  await logActivity({
    organizationId: session.org,
    contactId: lead.id,
    userId: session.sub,
    kind: "SUMMARY_SAVED",
    // The body lives on the contact; the timeline only records that it changed.
    meta: { cleared: summary === "" },
  });
  refresh(lead.id);
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  const lead = await ownLead(session, id);
  await prisma.leadNote.create({
    data: { organizationId: session.org, contactId: lead.id, userId: session.sub, body },
  });
  await logActivity({
    organizationId: session.org,
    contactId: lead.id,
    userId: session.sub,
    kind: "NOTE_ADDED",
  });
  refresh(lead.id);
}

/** Add or remove one tag. `op` distinguishes them so one form can do both. */
export async function setTagAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const tag = String(formData.get("tag") ?? "").trim();
  const remove = String(formData.get("op") ?? "") === "remove";
  if (!tag) return;

  const lead = await ownLead(session, id);
  const before = lead.tags;
  const tags = remove ? before.filter((t) => t !== tag) : [...new Set([...before, tag])];
  if (tags.length === before.length && !remove) return;
  if (remove && tags.length === before.length) return;

  await prisma.contact.update({ where: { id: lead.id }, data: { tags } });
  await logActivity({
    organizationId: session.org,
    contactId: lead.id,
    userId: session.sub,
    kind: "TAGS_CHANGED",
    fromValue: before.join(", "),
    toValue: tags.join(", "),
  });
  refresh(lead.id);
}

export async function deleteNoteAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const noteId = String(formData.get("noteId") ?? "");
  const note = await prisma.leadNote.findFirst({
    where: { id: noteId, organizationId: session.org },
  });
  if (!note) return;
  // Agents may retract their own notes; admins may remove any.
  if (note.userId !== session.sub && session.role === "AGENT") return;

  await prisma.leadNote.delete({ where: { id: note.id } });
  refresh(note.contactId);
}

/**
 * Apply one change to many leads at once.
 *
 * Ids come from checkboxes, so the org filter and the caller's row visibility
 * are applied inside the queries rather than trusted from the form — a tampered
 * payload updates nothing it could not have updated one at a time.
 */
export async function bulkAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const ids = [...new Set(formData.getAll("ids").map(String).filter(Boolean))];
  // The submit button carries `op`; each operation reads its own select, since
  // one form cannot have two controls sharing a name.
  const op = String(formData.get("op") ?? "");
  const value = String(
    formData.get(op === "status" ? "statusValue" : "ownerValue") ?? "",
  );
  if (ids.length === 0) return;

  const visibility = leadVisibility({ userId: session.sub, role: session.role as Role });
  const scoped = { id: { in: ids }, organizationId: session.org, ...(visibility ?? {}) };

  if (op === "status" && isLeadStatus(value)) {
    const before = await prisma.contact.findMany({
      where: { ...scoped, status: { not: value } },
      select: { id: true, status: true },
    });
    await prisma.contact.updateMany({ where: scoped, data: { status: value } });
    for (const lead of before) {
      await logActivity({
        organizationId: session.org,
        contactId: lead.id,
        userId: session.sub,
        kind: "STATUS_CHANGED",
        fromValue: lead.status,
        toValue: value,
        meta: { bulk: true },
      });
    }
  } else if (op === "owner") {
    const ownerUserId = value === "" ? null : value;
    if (!mayAssignTo(session, ownerUserId)) return;
    if (ownerUserId) {
      const member = await prisma.user.findFirst({
        where: { id: ownerUserId, organizationId: session.org },
        select: { id: true },
      });
      if (!member) return;
    }
    const before = await prisma.contact.findMany({
      where: { ...scoped, NOT: { ownerUserId } },
      select: { id: true, ownerUserId: true },
    });
    await prisma.contact.updateMany({ where: scoped, data: { ownerUserId } });
    for (const lead of before) {
      await logActivity({
        organizationId: session.org,
        contactId: lead.id,
        userId: session.sub,
        kind: "OWNER_ASSIGNED",
        fromValue: lead.ownerUserId,
        toValue: ownerUserId,
        meta: { bulk: true },
      });
    }
  }

  revalidatePath("/dashboard/leads");
}
