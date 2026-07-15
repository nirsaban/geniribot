import { prisma } from "@kesher/db";
import { generateSlots, type Slot } from "@kesher/scheduling";

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
    busy: booked.map((b) => ({ start: b.startsAt, end: b.endsAt })),
  });

  return slots.slice(0, OFFER_COUNT);
}

/** The numbered slot menu sent to the lead. */
export function slotMenu(slots: Slot[]): string {
  const lines = slots.map((s, i) => `${i + 1}. ${formatSlot(s.start)}`);
  return "מעולה! בחר/י מועד נוח לשיחה (שלח/י מספר):\n" + lines.join("\n");
}
