import { type ActivityKind, prisma, type Prisma } from "./index.js";

/**
 * Append one entry to a lead's audit trail.
 *
 * Shared by the dashboard (agent actions) and the worker (bot events) so both
 * write the same shape — the timeline is only useful for a handoff if every
 * actor records into it consistently.
 *
 * Best-effort by design: an audit write must never be the reason a status
 * change or an inbound message fails. Failures are swallowed and reported to
 * the caller rather than thrown.
 */
export async function logActivity(entry: {
  organizationId: string;
  contactId: string;
  /** Omit for bot/system events — rendered as "the bot" in the timeline. */
  userId?: string | null;
  kind: ActivityKind;
  fromValue?: string | null;
  toValue?: string | null;
  meta?: Prisma.InputJsonValue;
  /** Pass a transaction client to make the entry atomic with its change. */
  tx?: Prisma.TransactionClient;
}): Promise<boolean> {
  const { tx, ...data } = entry;
  try {
    await (tx ?? prisma).leadActivity.create({ data });
    return true;
  } catch {
    return false;
  }
}
