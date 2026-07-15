import { describe, expect, it } from "vitest";
import { generateSlots, overlaps } from "./index.js";

// 2026-01-05 is a Monday (UTC weekday 1).
const MON = new Date("2026-01-05T00:00:00.000Z");

describe("generateSlots", () => {
  it("produces slots within the availability window", () => {
    const slots = generateSlots({
      rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60, slotMinutes: 30 }],
      from: MON,
      days: 1,
      now: MON,
    });
    // 09:00, 09:30, 10:00, 10:30  → 4 slots
    expect(slots).toHaveLength(4);
    expect(slots[0]!.start.toISOString()).toBe("2026-01-05T09:00:00.000Z");
    expect(slots[3]!.start.toISOString()).toBe("2026-01-05T10:30:00.000Z");
  });

  it("excludes busy intervals", () => {
    const slots = generateSlots({
      rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60, slotMinutes: 30 }],
      from: MON,
      days: 1,
      now: MON,
      busy: [
        { start: new Date("2026-01-05T09:30:00Z"), end: new Date("2026-01-05T10:00:00Z") },
      ],
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-05T10:00:00.000Z",
      "2026-01-05T10:30:00.000Z",
    ]);
  });

  it("respects min-notice", () => {
    const slots = generateSlots({
      rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60, slotMinutes: 30 }],
      from: MON,
      days: 1,
      now: new Date("2026-01-05T09:45:00Z"),
      minNoticeMinutes: 60, // earliest bookable = 10:45
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([]);
  });

  it("applies buffer between slots", () => {
    const slots = generateSlots({
      rules: [
        { weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60, slotMinutes: 30, bufferMinutes: 15 },
      ],
      from: MON,
      days: 1,
      now: MON,
    });
    // step = 45min: 09:00, 09:45, 10:30
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-05T09:45:00.000Z",
      "2026-01-05T10:30:00.000Z",
    ]);
  });
});

describe("overlaps", () => {
  it("detects overlap and adjacency", () => {
    const a = { start: new Date("2026-01-05T09:00Z"), end: new Date("2026-01-05T10:00Z") };
    expect(overlaps(a, { start: new Date("2026-01-05T09:30Z"), end: new Date("2026-01-05T10:30Z") })).toBe(true);
    // adjacent (touching) is NOT overlapping
    expect(overlaps(a, { start: new Date("2026-01-05T10:00Z"), end: new Date("2026-01-05T11:00Z") })).toBe(false);
  });
});
