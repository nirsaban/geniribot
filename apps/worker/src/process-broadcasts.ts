import { childLogger } from "@kesher/core";
import { prisma } from "@kesher/db";
import { OUTBOUND_JOB, outboundQueue } from "./queues.js";

const log = childLogger("worker:broadcasts");

/**
 * Spacing between two broadcast messages from one number. WhatsApp bans
 * numbers that blast; a human-ish cadence is the single best protection.
 */
const SPACING_MS = 3000;

/** Recipients handled per sweep per broadcast; the next sweep takes the rest. */
const BATCH_SIZE = 200;

function renderTemplate(template: string, name: string | null): string {
  return template
    .replace(/\{name\}/g, name ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([,!?.])/g, "$1");
}

/**
 * One sweep: pick up due broadcasts and push their pending recipients onto the
 * outbound queue, spaced out via BullMQ delayed jobs (the throttle lives in the
 * job delays, so a worker restart mid-broadcast loses nothing).
 *
 * A broadcast whose org has no CONNECTED WhatsApp connection stays SCHEDULED
 * and is retried next sweep — messages queue up behind the re-pair instead of
 * failing the whole campaign.
 */
export async function processBroadcasts(now: Date = new Date()): Promise<void> {
  const due = await prisma.broadcast.findMany({
    where: {
      status: { in: ["SCHEDULED", "SENDING"] },
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    take: 10,
  });

  for (const b of due) {
    const conn = b.connectionId
      ? await prisma.whatsAppConnection.findFirst({
          where: { id: b.connectionId, organizationId: b.organizationId },
          select: { id: true, status: true },
        })
      : await prisma.whatsAppConnection.findFirst({
          where: { organizationId: b.organizationId, status: "CONNECTED" },
          select: { id: true, status: true },
        });
    if (!conn || conn.status !== "CONNECTED") {
      log.warn({ broadcastId: b.id }, "no connected WhatsApp — broadcast waits");
      continue;
    }

    if (b.status === "SCHEDULED") {
      await prisma.broadcast.update({ where: { id: b.id }, data: { status: "SENDING" } });
    }

    const pending = await prisma.broadcastRecipient.findMany({
      where: { broadcastId: b.id, status: "PENDING" },
      take: BATCH_SIZE,
    });

    let sent = 0;
    let failed = 0;
    for (const [i, r] of pending.entries()) {
      const digits = r.phone.replace(/\D/g, "");
      if (digits.length < 9) {
        failed++;
        await prisma.broadcastRecipient.update({
          where: { id: r.id },
          data: { status: "FAILED", error: "invalid_phone" },
        });
        continue;
      }
      // Make (or link) a CRM lead so a reply threads into a conversation and
      // the campaign's answers land somewhere visible.
      const contact = await prisma.contact.upsert({
        where: { organizationId_phone: { organizationId: b.organizationId, phone: digits } },
        update: {},
        create: {
          organizationId: b.organizationId,
          phone: digits,
          name: r.name,
          source: b.name,
          tags: ["תפוצה"],
        },
      });
      await outboundQueue.add(
        OUTBOUND_JOB,
        {
          organizationId: b.organizationId,
          connectionId: conn.id,
          to: digits,
          toJid: contact.waJid ?? undefined,
          text: renderTemplate(b.message, r.name ?? contact.name),
        },
        { delay: i * SPACING_MS },
      );
      sent++;
      await prisma.broadcastRecipient.update({
        where: { id: r.id },
        data: { status: "SENT", sentAt: new Date(now.getTime() + i * SPACING_MS), contactId: contact.id },
      });
    }

    const remaining = await prisma.broadcastRecipient.count({
      where: { broadcastId: b.id, status: "PENDING" },
    });
    await prisma.broadcast.update({
      where: { id: b.id },
      data: {
        sentCount: { increment: sent },
        failedCount: { increment: failed },
        ...(remaining === 0 ? { status: "SENT" } : {}),
      },
    });
    log.info({ broadcastId: b.id, sent, failed, remaining }, "broadcast batch enqueued");
  }
}
