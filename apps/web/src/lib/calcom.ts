import { normalizePhone } from "@/lib/audience";

/**
 * Reading Cal.com booking payloads. Kept apart from the webhook route so it is
 * testable without dragging in Prisma and the Redis-backed outbound queue.
 */

export interface CalcomAttendee {
  name?: string;
  email?: string;
  phoneNumber?: string;
  timeZone?: string;
}

export interface CalcomPayload {
  uid?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  attendees?: CalcomAttendee[];
  responses?: Record<string, unknown>;
  location?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Cal.com sends form answers either flat or wrapped as `{ label, value }`. */
function unwrapAnswer(v: unknown): unknown {
  return isRecord(v) && "value" in v ? v.value : v;
}

/**
 * The number the ATTENDEE gave us, normalized to WhatsApp form — or null.
 *
 * Only attendee-controlled fields count. `payload.location` is deliberately NOT
 * one of them: on an event type whose location is `userPhone`, Cal.com fills it
 * with the HOST's number on every single booking. Reading it meant every booking
 * "matched" whichever contact owned the host's number, and that one person
 * received every lead's confirmation.
 *
 * The location answer is only a phone when the attendee picked the "phone call"
 * option and typed their own number — `{ value: "phone", optionValue: "05…" }`.
 * Any other option (`userPhone`, `attendeeInPerson`, `integrations:daily`) is
 * someone else's address and must be ignored.
 */
export function attendeePhone(p: CalcomPayload): string | null {
  const candidates: unknown[] = [];
  for (const a of p.attendees ?? []) candidates.push(a.phoneNumber);

  const responses = p.responses ?? {};
  candidates.push(
    unwrapAnswer(responses.attendeePhoneNumber),
    unwrapAnswer(responses.smsReminderNumber),
    unwrapAnswer(responses.phone),
  );

  const location = unwrapAnswer(responses.location);
  if (isRecord(location) && location.value === "phone") candidates.push(location.optionValue);

  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const phone = normalizePhone(c);
    if (phone) return phone;
  }
  return null;
}

export function attendeeName(p: CalcomPayload): string | null {
  return p.attendees?.[0]?.name?.trim() || null;
}
