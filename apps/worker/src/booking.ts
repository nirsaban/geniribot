import { prisma } from "@kesher/db";
import { generateSlots, type Interval, type Slot } from "@kesher/scheduling";
import { childLogger } from "@kesher/core";
import { orgCalendar } from "./calendar.js";

const blog = childLogger("worker:booking");

const OFFER_COUNT = 5;
const LOOKAHEAD_DAYS = 14;
const MIN_NOTICE_MIN = 120;

const fmt = new Intl.DateTimeFormat("he-IL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem",
});

export function formatSlot(d: Date): string {
  return fmt.format(d);
}

/** Next open slots for an org (availability minus existing appointments). */
export async function offerSlots(
  organizationId: string,
  now: Date = new Date(),
): Promise<Slot[]> {
  const rules = await prisma.availabilityRule.findMany({ where: { organizationId } });
  if (rules.length === 0) return [];

  const booked = await prisma.appointment.findMany({
    where: {
      organizationId,
      status: { in: ["BOOKED", "CONFIRMED"] },
      endsAt: { gte: now },
    },
    select: { startsAt: true, endsAt: true },
  });

  const busy: Interval[] = booked.map((b) => ({ start: b.startsAt, end: b.endsAt }));

  // Merge the connected Google Calendar's busy blocks (if any).
  const cal = await orgCalendar(organizationId);
  if (cal) {
    try {
      const until = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 3600 * 1000);
      const gbusy = await cal.freeBusy(now.toISOString(), until.toISOString());
      busy.push(...gbusy);
    } catch (err) {
      blog.warn({ err: (err as Error).message }, "google freeBusy failed; ignoring");
    }
  }

  const slots = generateSlots({
    rules: rules.map((r) => ({
      weekday: r.weekday,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      slotMinutes: r.slotMinutes,
      bufferMinutes: r.bufferMinutes,
    })),
    from: now,
    days: LOOKAHEAD_DAYS,
    now,
    minNoticeMinutes: MIN_NOTICE_MIN,
    busy,
  });

  return slots.slice(0, OFFER_COUNT);
}

/** The numbered slot menu sent to the lead. */
export function slotMenu(slots: Slot[]): string {
  const lines = slots.map((s, i) => `${i + 1}. ${formatSlot(s.start)}`);
  return "מעולה! בחר/י מועד נוח לשיחה (שלח/י מספר):\n" + lines.join("\n");
}
