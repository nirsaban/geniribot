import { childLogger } from "@kesher/core";
import { prisma } from "@kesher/db";
import { OUTBOUND_JOB, outboundQueue } from "./queues.js";

const log = childLogger("worker:followups");

/**
 * Statuses still worth nudging. MEETING_SET/WON need no chasing and LOST is
 * over — auto-messaging either would read as spam.
 */
const NUDGEABLE = ["NEW", "CONTACTED", "QUALIFIED"] as const;

const DEFAULT_MESSAGE =
  "היי {name}, ראיתי שלא סיימנו את השיחה 🙂 אשמח לעזור אם עדיין רלוונטי!";

/** Only message people during Israeli waking/business hours. */
function withinSendWindow(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Jerusalem",
    }).format(now),
  );
  return hour >= 9 && hour < 20;
}

function renderTemplate(template: string, name: string | null): string {
  return template
    .replaceAll("{name}", name ?? "")
    .replace(/\s{2,}/g, " ")
    .replace(/^היי\s*,/, "היי,")
    .trim();
}

/**
 * One sweep: for every org that opted in, nudge leads that went quiet.
 *
 * A lead qualifies when it has been silent for `followUpAfterHours` AND its
 * last nudge (if any) is at least that old too — so replies reset the clock via
 * `lastContactedAt`, and nudges space themselves out rather than firing every
 * sweep. `followUpMax` caps the total per lead.
 */
export async function processFollowUps(now: Date = new Date()): Promise<void> {
  if (!withinSendWindow(now)) return;

  const orgs = await prisma.organization.findMany({
    where: { followUpEnabled: true },
    select: { id: true, followUpAfterHours: true, followUpMax: true, followUpMessage: true },
  });

  for (const org of orgs) {
    const conn = await prisma.whatsAppConnection.findFirst({
      where: { organizationId: org.id, status: "CONNECTED" },
      select: { id: true },
    });
    if (!conn) continue; // nothing to send from

    const cutoff = new Date(now.getTime() - org.followUpAfterHours * 3600 * 1000);
    const due = await prisma.contact.findMany({
      where: {
        organizationId: org.id,
        status: { in: [...NUDGEABLE] },
        followUpCount: { lt: org.followUpMax },
        lastContactedAt: { not: null, lt: cutoff },
        OR: [{ lastFollowUpAt: null }, { lastFollowUpAt: { lt: cutoff } }],
      },
      select: { id: true, phone: true, waJid: true, name: true },
      take: 50, // per-sweep safety cap; the next sweep picks up the rest
    });

    for (const contact of due) {
      const text = renderTemplate(org.followUpMessage || DEFAULT_MESSAGE, contact.name);
      await outboundQueue.add(OUTBOUND_JOB, {
        organizationId: org.id,
        connectionId: conn.id,
        to: contact.phone,
        toJid: contact.waJid ?? undefined,
        text,
      });
      await prisma.$transaction([
        prisma.contact.update({
          where: { id: contact.id },
          data: { followUpCount: { increment: 1 }, lastFollowUpAt: now },
        }),
        prisma.leadActivity.create({
          data: {
            organizationId: org.id,
            contactId: contact.id,
            kind: "FOLLOW_UP_SENT",
            meta: { text },
          },
        }),
      ]);
      log.info({ contactId: contact.id, organizationId: org.id }, "follow-up sent");
    }
  }
}
