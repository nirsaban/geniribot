import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@kesher/db";
import { attendeeName, attendeePhone, type CalcomPayload } from "@/lib/calcom";
import { OUTBOUND_JOB, outboundQueue, type OutboundJob } from "@/lib/outboundQueue";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/**
 * Cal.com webhook receiver — one URL per tenant, the org id is in the path.
 *
 * When a lead books through the org's Cal.com link, this records the
 * appointment and advances the lead to MEETING_SET, so the CRM reflects the
 * booking without anyone touching it. Cancellations and reschedules keep the
 * appointment row in sync.
 *
 * Authenticity: Cal.com signs the raw body with HMAC-SHA256 in
 * `x-cal-signature-256` using the webhook's secret. The tenant stores the same
 * secret here (Settings → Cal.com). Verification is required — an unsigned
 * endpoint that mutates leads by phone number would be an open write API.
 */

const SECRET_NAME = "calcom_webhook_secret";

interface CalcomEvent {
  triggerEvent?: string;
  payload?: CalcomPayload;
}

function verifySignature(raw: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** How confident we are that `contact` is the person who booked. */
type MatchedBy = "phone" | "created_from_booking" | "name" | "recent_activity";

/**
 * Resolve the booking to the lead who actually booked it.
 *
 * Strongest first:
 *  1. the attendee's own phone vs. a lead's number — the only identifier both
 *     systems share, and the only one we can message,
 *  2. that phone with no lead behind it: plenty of people book straight off the
 *     Cal.com link without ever messaging the bot, so the booking *is* the
 *     lead — create it rather than pinning the meeting onto a stranger,
 *  3. exact attendee name,
 *  4. the lead most recently active on WhatsApp.
 *
 * `confirmable` marks whether we know the booker well enough to message them.
 * Case 4 is a guess: it fires when the booking carries no phone and no known
 * name, so the "most recent chatter" is simply whoever happened to be talking
 * to the bot — messaging them would confirm a meeting they never booked.
 */
async function resolveBooker(organizationId: string, p: CalcomPayload) {
  const phone = attendeePhone(p);
  const name = attendeeName(p);

  if (phone) {
    // Suffix-match (last 9 digits) so "+972 50…" and "050…" formats meet.
    const tail = phone.slice(-9);
    const byPhone = await prisma.contact.findFirst({
      where: { organizationId, phone: { endsWith: tail } },
      orderBy: { lastContactedAt: "desc" },
    });
    if (byPhone) return { contact: byPhone, matchedBy: "phone" as MatchedBy, confirmable: true };

    // Upsert, not create: two Cal.com deliveries for the same new booker would
    // otherwise race on the (organizationId, phone) unique.
    const created = await prisma.contact.upsert({
      where: { organizationId_phone: { organizationId, phone } },
      create: { organizationId, phone, name, source: "Cal.com" },
      update: {},
    });
    return { contact: created, matchedBy: "created_from_booking" as MatchedBy, confirmable: true };
  }

  if (name) {
    const byName = await prisma.contact.findFirst({
      where: { organizationId, name: { equals: name, mode: "insensitive" } },
      orderBy: { lastContactedAt: "desc" },
    });
    if (byName) return { contact: byName, matchedBy: "name" as MatchedBy, confirmable: true };
  }

  const RECENT_MS = 3 * 3600 * 1000;
  const recent = await prisma.contact.findFirst({
    where: { organizationId, lastContactedAt: { gte: new Date(Date.now() - RECENT_MS) } },
    orderBy: { lastContactedAt: "desc" },
  });
  if (recent) return { contact: recent, matchedBy: "recent_activity" as MatchedBy, confirmable: false };
  return null;
}

const whenFmt = new Intl.DateTimeFormat("he-IL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem",
});

/**
 * Confirm the booking back to the lead on WhatsApp, inside the same
 * conversation the booking link was sent from — so the chat reads as one
 * continuous thread: link → they booked → "you're booked for Wednesday 14:00".
 *
 * Best-effort by design: the appointment is already recorded, and a WhatsApp
 * hiccup must not make Cal.com retry (and re-process) the whole webhook.
 */
async function sendBookingSummary(
  organizationId: string,
  contact: { id: string; phone: string; waJid: string | null; name: string | null },
  startsAt: Date,
  title: string | null,
): Promise<void> {
  try {
    // The conversation the booking link went out on; its connection is the
    // number the lead is already talking to.
    const existing = await prisma.conversation.findFirst({
      where: { organizationId, contactId: contact.id },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true, connectionId: true },
    });
    const conn = existing
      ? { id: existing.connectionId }
      : await prisma.whatsAppConnection.findFirst({
          where: { organizationId, status: "CONNECTED" },
          select: { id: true },
        });
    if (!conn) return; // nowhere to send from

    // Someone who booked off the link has no thread yet — open one (no flow, so
    // the bot won't start interrogating them) so the confirmation is visible in
    // the CRM instead of vanishing into the queue.
    const convo =
      existing ??
      (await prisma.conversation.create({
        data: { organizationId, contactId: contact.id, connectionId: conn.id, state: {} },
        select: { id: true, connectionId: true },
      }));

    const text =
      `הפגישה נקבעה בהצלחה! ✅\n` +
      `📅 ${whenFmt.format(startsAt)}` +
      (title ? `\n📝 ${title}` : "") +
      `\nנתראה! 🙏`;

    // Record in the transcript first (mirrors the worker's sendOut order), so
    // the dashboard shows the confirmation even if the send lags.
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "OUT", body: text },
    });
    await prisma.conversation.update({
      where: { id: convo.id },
      data: { lastMessageAt: new Date() },
    });
    const job: OutboundJob = {
      organizationId,
      connectionId: conn.id,
      to: contact.phone,
      toJid: contact.waJid ?? undefined,
      text,
    };
    await outboundQueue.add(OUTBOUND_JOB, job);
  } catch (err) {
    console.error("calcom webhook: booking summary send failed", err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return NextResponse.json({ error: "unknown_org" }, { status: 404 });

  const secret = await getSecret(orgId, SECRET_NAME);
  if (!secret) return NextResponse.json({ error: "webhook_not_configured" }, { status: 401 });

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-cal-signature-256"), secret)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let event: CalcomEvent;
  try {
    event = JSON.parse(raw) as CalcomEvent;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const trigger = event.triggerEvent ?? "";
  const p = event.payload ?? {};

  // Cancels/reschedules address an appointment we already know by uid.
  if (trigger === "BOOKING_CANCELLED" || trigger === "BOOKING_RESCHEDULED") {
    const uid = p.uid;
    const appt = uid
      ? await prisma.appointment.findFirst({ where: { calcomUid: uid, organizationId: orgId } })
      : null;
    if (!appt) return NextResponse.json({ ok: true, note: "no_matching_appointment" });

    if (trigger === "BOOKING_CANCELLED") {
      await prisma.$transaction([
        prisma.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED" } }),
        prisma.leadActivity.create({
          data: {
            organizationId: orgId,
            contactId: appt.contactId,
            kind: "APPOINTMENT_CANCELLED",
            meta: { calcomUid: uid },
          },
        }),
      ]);
    } else if (p.startTime && p.endTime) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { startsAt: new Date(p.startTime), endsAt: new Date(p.endTime), status: "BOOKED" },
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (trigger !== "BOOKING_CREATED") {
    return NextResponse.json({ ok: true, note: "ignored_event" });
  }

  if (!p.startTime || !p.endTime) {
    return NextResponse.json({ error: "missing_times" }, { status: 400 });
  }

  const match = await resolveBooker(orgId, p);
  if (!match) return NextResponse.json({ ok: true, note: "no_matching_lead" });
  const { contact, matchedBy, confirmable } = match;

  // Idempotency: Cal.com retries deliveries; the unique calcomUid makes a
  // second create a no-op instead of a duplicate meeting.
  if (p.uid) {
    const existing = await prisma.appointment.findUnique({ where: { calcomUid: p.uid } });
    if (existing) return NextResponse.json({ ok: true, note: "already_recorded" });
  }

  const advance = contact.status === "NEW" || contact.status === "CONTACTED" || contact.status === "QUALIFIED";
  await prisma.$transaction([
    prisma.appointment.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        userId: contact.ownerUserId,
        startsAt: new Date(p.startTime),
        endsAt: new Date(p.endTime),
        status: "BOOKED",
        calcomUid: p.uid ?? null,
      },
    }),
    // The attendee typed their real name into the booking form — better data
    // than a missing name, but never overwrite one an agent already set.
    ...(!contact.name && attendeeName(p)
      ? [prisma.contact.update({ where: { id: contact.id }, data: { name: attendeeName(p) } })]
      : []),
    ...(advance
      ? [prisma.contact.update({ where: { id: contact.id }, data: { status: "MEETING_SET" } })]
      : []),
    prisma.leadActivity.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        kind: "APPOINTMENT_BOOKED",
        // attendee* is kept so a mis-attributed booking can be traced back to
        // who Cal.com actually said booked it.
        meta: {
          calcomUid: p.uid ?? null,
          matchedBy,
          title: p.title ?? null,
          attendeeName: attendeeName(p),
          attendeePhone: attendeePhone(p),
        },
      },
    }),
    ...(advance
      ? [
          prisma.leadActivity.create({
            data: {
              organizationId: orgId,
              contactId: contact.id,
              kind: "STATUS_CHANGED",
              fromValue: contact.status,
              toValue: "MEETING_SET",
            },
          }),
        ]
      : []),
  ]);

  // Only message someone we actually identified. A `recent_activity` guess used
  // to confirm the meeting to whoever last chatted with the bot.
  if (confirmable) {
    await sendBookingSummary(orgId, contact, new Date(p.startTime), p.title ?? null);
  } else {
    console.warn(
      `calcom webhook: booking ${p.uid} has no attendee phone and no known name — ` +
        `recorded against contact ${contact.id} but no confirmation sent`,
    );
  }

  return NextResponse.json({ ok: true, matchedBy, confirmed: confirmable });
}
