import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@kesher/db";
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

interface CalcomAttendee {
  name?: string;
  email?: string;
  phoneNumber?: string;
  timeZone?: string;
}

interface CalcomPayload {
  uid?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  attendees?: CalcomAttendee[];
  responses?: Record<string, { value?: unknown } | unknown>;
  location?: string;
}

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

/** Pull anything phone-shaped out of the booking (attendee field or a form answer). */
function extractPhone(p: CalcomPayload): string | null {
  const candidates: unknown[] = [];
  for (const a of p.attendees ?? []) candidates.push(a.phoneNumber);
  for (const v of Object.values(p.responses ?? {})) {
    candidates.push(typeof v === "object" && v !== null && "value" in v ? (v as { value: unknown }).value : v);
  }
  candidates.push(p.location);
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const digits = c.replace(/\D/g, "");
    // 9+ digits smells like a phone number; shorter strings are answers/emails.
    if (digits.length >= 9) return digits;
  }
  return null;
}

function attendeeName(p: CalcomPayload): string | null {
  return p.attendees?.[0]?.name?.trim() || null;
}

/**
 * Match the booking to a lead.
 *
 * Cal.com's default form asks for name+email while leads are keyed by phone,
 * so matching is best-effort, strongest first:
 *  1. phone digits from the booking vs. the lead's number,
 *  2. exact attendee name,
 *  3. the lead most recently active on WhatsApp (they were just sent the
 *     booking link there, minutes ago).
 */
async function matchContact(organizationId: string, p: CalcomPayload) {
  const phone = extractPhone(p);
  if (phone) {
    // Suffix-match (last 9 digits) so "+972 50…" and "050…" formats meet.
    const tail = phone.slice(-9);
    const byPhone = await prisma.contact.findFirst({
      where: { organizationId, phone: { endsWith: tail } },
      orderBy: { lastContactedAt: "desc" },
    });
    if (byPhone) return { contact: byPhone, matchedBy: "phone" as const };
  }

  const name = attendeeName(p);
  if (name) {
    const byName = await prisma.contact.findFirst({
      where: { organizationId, name: { equals: name, mode: "insensitive" } },
      orderBy: { lastContactedAt: "desc" },
    });
    if (byName) return { contact: byName, matchedBy: "name" as const };
  }

  const RECENT_MS = 3 * 3600 * 1000;
  const recent = await prisma.contact.findFirst({
    where: { organizationId, lastContactedAt: { gte: new Date(Date.now() - RECENT_MS) } },
    orderBy: { lastContactedAt: "desc" },
  });
  if (recent) return { contact: recent, matchedBy: "recent_activity" as const };
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
    const convo = await prisma.conversation.findFirst({
      where: { organizationId, contactId: contact.id },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true, connectionId: true },
    });
    const conn = convo
      ? { id: convo.connectionId }
      : await prisma.whatsAppConnection.findFirst({
          where: { organizationId, status: "CONNECTED" },
          select: { id: true },
        });
    if (!conn) return; // nowhere to send from

    const text =
      `הפגישה נקבעה בהצלחה! ✅\n` +
      `📅 ${whenFmt.format(startsAt)}` +
      (title ? `\n📝 ${title}` : "") +
      `\nנתראה! 🙏`;

    // Record in the transcript first (mirrors the worker's sendOut order), so
    // the dashboard shows the confirmation even if the send lags.
    if (convo) {
      await prisma.message.create({
        data: { conversationId: convo.id, direction: "OUT", body: text },
      });
      await prisma.conversation.update({
        where: { id: convo.id },
        data: { lastMessageAt: new Date() },
      });
    }
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

  const match = await matchContact(orgId, p);
  if (!match) return NextResponse.json({ ok: true, note: "no_matching_lead" });
  const { contact, matchedBy } = match;

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
        meta: { calcomUid: p.uid ?? null, matchedBy, title: p.title ?? null },
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

  await sendBookingSummary(orgId, contact, new Date(p.startTime), p.title ?? null);

  return NextResponse.json({ ok: true, matchedBy });
}
