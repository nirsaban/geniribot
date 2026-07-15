import { childLogger } from "@kesher/core";
import { prisma } from "@kesher/db";
import { formatSlot } from "./booking.js";
import { OUTBOUND_JOB, outboundQueue, type ReminderJob } from "./queues.js";

const log = childLogger("worker:reminder");

/**
 * Fire a WhatsApp reminder for an upcoming appointment. Skips appointments that
 * were cancelled/completed. Sends via the connection from the contact's most
 * recent conversation.
 */
export async function processReminder(job: ReminderJob): Promise<void> {
  const appt = await prisma.appointment.findUnique({
    where: { id: job.appointmentId },
    include: { contact: true },
  });
  if (!appt) return;
  if (appt.status === "CANCELLED" || appt.status === "COMPLETED" || appt.status === "NO_SHOW") {
    log.info({ appointmentId: appt.id, status: appt.status }, "reminder skipped");
    return;
  }

  const convo = await prisma.conversation.findFirst({
    where: { contactId: appt.contactId },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!convo) return;

  const when = formatSlot(appt.startsAt);
  const text =
    job.kind === "24h"
      ? `תזכורת 🗓️ יש לך שיחה מחר ב־${when}. נתראה!`
      : `תזכורת 📞 השיחה שלך מתחילה בעוד כשעה (${when}).`;

  await prisma.message.create({
    data: { conversationId: convo.id, direction: "OUT", body: text },
  });
  await outboundQueue.add(OUTBOUND_JOB, {
    organizationId: appt.organizationId,
    connectionId: convo.connectionId,
    to: appt.contact.phone,
    text,
  });
  log.info({ appointmentId: appt.id, kind: job.kind }, "reminder sent");
}
