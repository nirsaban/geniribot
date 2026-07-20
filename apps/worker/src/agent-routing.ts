import { childLogger, sendMail } from "@kesher/core";
import { logActivity, prisma } from "@kesher/db";

const log = childLogger("worker:routing");

/**
 * Assigning leads to salespeople and telling them about it — the two flow
 * actions that turn the bot from a form into a hand-off.
 */

/** Roles that can be handed a lead. Owners are included: small teams sell too. */
const ASSIGNABLE_ROLES = ["OWNER", "ADMIN", "AGENT"] as const;

/**
 * Pick who gets the lead.
 *
 * `params.userId` names someone explicitly; otherwise the least-loaded member
 * wins, counting only leads still in play. Round-robin by insertion order would
 * keep handing leads to whoever happens to be first when the team is idle, and
 * counting closed leads would permanently penalise the best closer.
 */
async function pickAssignee(
  organizationId: string,
  params: Record<string, unknown> | undefined,
): Promise<string | null> {
  const explicit = typeof params?.userId === "string" ? params.userId : null;
  if (explicit) {
    const member = await prisma.user.findFirst({
      where: { id: explicit, organizationId },
      select: { id: true },
    });
    if (member) return member.id;
    log.warn({ organizationId, userId: explicit }, "assign_owner: named user not in org; falling back");
  }

  const members = await prisma.user.findMany({
    where: { organizationId, role: { in: [...ASSIGNABLE_ROLES] } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (members.length === 0) return null;

  const open = await prisma.contact.groupBy({
    by: ["ownerUserId"],
    where: {
      organizationId,
      ownerUserId: { in: members.map((m) => m.id) },
      status: { notIn: ["WON", "LOST"] },
    },
    _count: { _all: true },
  });
  const load = new Map(open.map((r) => [r.ownerUserId, r._count._all]));

  // Ties resolve to the earliest-created member, which keeps the choice stable
  // and testable rather than depending on row order.
  let best = members[0]!.id;
  let bestLoad = load.get(best) ?? 0;
  for (const m of members.slice(1)) {
    const l = load.get(m.id) ?? 0;
    if (l < bestLoad) {
      best = m.id;
      bestLoad = l;
    }
  }
  return best;
}

/** Flow action `assign_owner`. Returns the assigned user id, if any. */
export async function assignOwner(
  organizationId: string,
  contactId: string,
  params: Record<string, unknown> | undefined,
): Promise<string | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { ownerUserId: true },
  });
  // Never steal a lead a human has already taken responsibility for.
  if (!contact || contact.ownerUserId) return contact?.ownerUserId ?? null;

  const userId = await pickAssignee(organizationId, params);
  if (!userId) {
    log.warn({ organizationId }, "assign_owner: no assignable members");
    return null;
  }

  await prisma.contact.update({ where: { id: contactId }, data: { ownerUserId: userId } });
  await logActivity({
    organizationId,
    contactId,
    // No userId: the bot assigned this, not a person.
    kind: "OWNER_ASSIGNED",
    toValue: userId,
    meta: { by: "bot" },
  });
  return userId;
}

/** Flow action `add_tag`. */
export async function addTag(
  organizationId: string,
  contactId: string,
  tag: string,
): Promise<void> {
  const clean = tag.trim();
  if (!clean) return;
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { tags: true },
  });
  if (!contact || contact.tags.includes(clean)) return;

  const tags = [...contact.tags, clean];
  await prisma.contact.update({ where: { id: contactId }, data: { tags } });
  await logActivity({
    organizationId,
    contactId,
    kind: "TAGS_CHANGED",
    fromValue: contact.tags.join(", "),
    toValue: tags.join(", "),
    meta: { by: "bot" },
  });
}

function leadUrl(contactId: string): string {
  const base = process.env.PUBLIC_BASE_URL ?? "https://wabot.miltech.cloud";
  return `${base}/dashboard/leads/${contactId}`;
}

/**
 * Flow action `notify_agent`.
 *
 * Prefers WhatsApp (this is a WhatsApp product — an agent reads it in seconds),
 * falling back to email when the member has no notify phone set. Best-effort
 * throughout: failing to notify must never fail the lead's conversation, so
 * every path logs rather than throws.
 *
 * `enqueueOutbound` is injected instead of imported so this module stays free of
 * the queue and can be tested without Redis.
 */
export async function notifyAgent(opts: {
  organizationId: string;
  contactId: string;
  connectionId: string;
  userId: string | null;
  /**
   * Answers captured earlier in this same step but not yet written to the
   * contact — `persist` runs after the action loop, so reading the row alone
   * would omit exactly the qualifying answers that make the alert worth sending.
   */
  pendingFields?: Record<string, unknown>;
  enqueueOutbound: (to: string, text: string) => Promise<void>;
}): Promise<void> {
  const { organizationId, contactId, connectionId, userId } = opts;

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { name: true, phone: true, fields: true, source: true },
  });
  if (!contact) return;

  const fields = {
    ...((contact.fields as Record<string, unknown>) ?? {}),
    ...(opts.pendingFields ?? {}),
  };

  // Notify the owner; with nobody assigned, fall back to the managers so a lead
  // is never left with no one told about it.
  const recipients = userId
    ? await prisma.user.findMany({ where: { id: userId, organizationId } })
    : await prisma.user.findMany({
        where: { organizationId, role: { in: ["OWNER", "ADMIN"] } },
      });
  if (recipients.length === 0) return;

  const answers = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `• ${k}: ${String(v)}`)
    .join("\n");

  // `name` is mirrored from the answers by `persist`, so for a first-run lead it
  // is still null on the row — fall back to the pending answer.
  const name = contact.name || (typeof fields.name === "string" ? fields.name : "") || "—";

  const title = `🔔 ליד חדש${contact.source ? ` — ${contact.source}` : ""}`;
  const body = [title, `שם: ${name}`, `טלפון: ${contact.phone}`, answers, leadUrl(contactId)]
    .filter(Boolean)
    .join("\n");

  for (const r of recipients) {
    if (r.notifyPhone) {
      try {
        await opts.enqueueOutbound(r.notifyPhone, body);
        continue;
      } catch (err) {
        log.warn({ err: (err as Error).message, userId: r.id }, "notify_agent: whatsapp enqueue failed");
      }
    }
    const res = await sendMail({ to: r.email, subject: title, text: body });
    if (!res.ok && res.error !== "smtp_not_configured") {
      log.warn({ userId: r.id, error: res.error }, "notify_agent: email failed");
    }
  }
  log.info({ contactId, connectionId, count: recipients.length }, "notify_agent: sent");
}
