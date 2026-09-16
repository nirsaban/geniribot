import { describe, expect, it } from "vitest";
import { attendeePhone, bookerContactId } from "@/lib/calcom";

/**
 * Regression cover for the confirmation-to-the-wrong-person bug: an event type
 * with a `userPhone` location puts the HOST's number in `payload.location`, and
 * reading it made every booking resolve to whichever lead owned that number.
 */
describe("attendeePhone", () => {
  it("ignores payload.location (that is the host's number on userPhone events)", () => {
    expect(attendeePhone({ location: "+972546619595", attendees: [{ name: "שלי ביטון" }] })).toBeNull();
  });

  it("ignores the location answer when the attendee did not pick a phone call", () => {
    expect(
      attendeePhone({
        responses: { location: { value: { value: "userPhone", optionValue: "+972546619595" } } },
      }),
    ).toBeNull();
  });

  it("takes the attendee's number from the attendee record", () => {
    expect(attendeePhone({ attendees: [{ name: "רותם שר", phoneNumber: "050-123-4567" }] })).toBe("972501234567");
  });

  it("takes the attendee's number from the dedicated booking field", () => {
    expect(attendeePhone({ responses: { attendeePhoneNumber: "+972 50 123 4567" } })).toBe("972501234567");
    expect(attendeePhone({ responses: { attendeePhoneNumber: { value: "0501234567" } } })).toBe("972501234567");
  });

  it("takes the number the attendee typed for a phone-call location", () => {
    expect(attendeePhone({ responses: { location: { value: { value: "phone", optionValue: "0501234567" } } } })).toBe(
      "972501234567",
    );
  });

  it("does not mistake an email or a short answer for a phone", () => {
    expect(attendeePhone({ responses: { email: "someone@example.com", notes: "1.09" } })).toBeNull();
  });

  it("returns null when the booking carries no attendee number at all", () => {
    expect(attendeePhone({ attendees: [{ name: "אבישי שלזינגר", email: "a@b.com" }] })).toBeNull();
  });
});

/**
 * The booking link the bot sends carries our contact id in `metadata[...]`;
 * Cal.com hands it back untouched. Without it a lead who retypes their name on
 * an event type with no phone question is unidentifiable, and the meeting is
 * recorded with nobody told it was set.
 */
describe("bookerContactId", () => {
  it("reads the id back off the booking metadata", () => {
    expect(bookerContactId({ metadata: { kesherContactId: "cmu3voboh000jl6jn" } })).toBe("cmu3voboh000jl6jn");
  });

  it("ignores Cal.com's own metadata", () => {
    expect(bookerContactId({ metadata: { videoCallUrl: "https://app.cal.com/video/x" } })).toBeNull();
  });

  it("is null for a booking made straight off the public link", () => {
    expect(bookerContactId({})).toBeNull();
    expect(bookerContactId({ metadata: {} })).toBeNull();
  });

  it("does not take a non-string or blank id", () => {
    expect(bookerContactId({ metadata: { kesherContactId: 42 } })).toBeNull();
    expect(bookerContactId({ metadata: { kesherContactId: "  " } })).toBeNull();
  });
});
