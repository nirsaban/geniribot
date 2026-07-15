/**
 * Native scheduling engine (pure). Turns availability rules into concrete open
 * slots, subtracting already-booked/busy intervals. No I/O, no DB — the worker
 * and booking pages feed it data and act on the result.
 *
 * NOTE: Phase 0 computes in UTC minutes-of-day. Proper per-tenant timezone
 * conversion (Intl/Temporal) and Google Calendar freebusy land in Phase 5.
 * See docs/ROADMAP.md.
 */

export interface AvailabilityRule {
  /** 0 = Sunday … 6 = Saturday (UTC weekday for Phase 0). */
  weekday: number;
  /** minutes from midnight */
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  bufferMinutes?: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface Slot {
  start: Date;
  end: Date;
}

export interface GenerateOptions {
  rules: AvailabilityRule[];
  /** Window start (inclusive). */
  from: Date;
  /** Number of days to look ahead. */
  days: number;
  /** Already-booked / busy intervals to exclude. */
  busy?: Interval[];
  /** Minimum notice before a slot can be booked (minutes). */
  minNoticeMinutes?: number;
  /** "now" for min-notice math; defaults to `from`. */
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

/** Generate bookable slots across the window. */
export function generateSlots(opts: GenerateOptions): Slot[] {
  const { rules, from, days, busy = [], minNoticeMinutes = 0 } = opts;
  const now = opts.now ?? from;
  const earliest = new Date(now.getTime() + minNoticeMinutes * MIN_MS);
  const slots: Slot[] = [];

  const startDay = startOfUtcDay(from);
  for (let d = 0; d < days; d++) {
    const dayStart = new Date(startDay.getTime() + d * DAY_MS);
    const weekday = dayStart.getUTCDay();
    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      const step = rule.slotMinutes + (rule.bufferMinutes ?? 0);
      if (step <= 0) continue;
      for (let m = rule.startMinute; m + rule.slotMinutes <= rule.endMinute; m += step) {
        const start = new Date(dayStart.getTime() + m * MIN_MS);
        const end = new Date(start.getTime() + rule.slotMinutes * MIN_MS);
        if (start < earliest) continue;
        if (overlapsAny({ start, end }, busy)) continue;
        slots.push({ start, end });
      }
    }
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function overlapsAny(slot: Interval, busy: Interval[]): boolean {
  return busy.some((b) => overlaps(slot, b));
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
