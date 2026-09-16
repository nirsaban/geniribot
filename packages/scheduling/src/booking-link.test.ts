import { describe, expect, it } from "vitest";
import { bookingLink } from "./booking-link.js";

/**
 * Cover for the "booking made, no confirmation sent" bug: the bot sent a bare
 * Cal.com link, the lead typed a different name into the booking form, and the
 * webhook could no longer tell which lead had booked — so it recorded the
 * meeting and said nothing.
 */
describe("bookingLink", () => {
  const base = "https://cal.com/eden/20min";

  it("carries the contact id back to us through Cal.com metadata", () => {
    const link = bookingLink(base, { contactId: "cmu3voboh000jl6jn" });
    // Literal brackets, as Cal.com's docs show and its parser expects.
    expect(link).toContain("metadata[kesherContactId]=cmu3voboh000jl6jn");
    expect(new URL(link).searchParams.get("metadata[kesherContactId]")).toBe("cmu3voboh000jl6jn");
  });

  it("prefills the lead's name", () => {
    const url = new URL(bookingLink(base, { name: "ניר" }));
    expect(url.searchParams.get("name")).toBe("ניר");
    expect(url.origin + url.pathname).toBe(base);
  });

  it("prefills the phone in E.164 on both phone questions", () => {
    const url = new URL(bookingLink(base, { name: "ניר", phone: "972532898849" }));
    expect(url.searchParams.get("attendeePhoneNumber")).toBe("+972532898849");
    expect(url.searchParams.get("smsReminderNumber")).toBe("+972532898849");
  });

  it("leaves out what we don't know", () => {
    const url = new URL(bookingLink(base, { contactId: null, name: null, phone: null }));
    expect([...url.searchParams.keys()]).toEqual([]);
  });

  it("treats a blank name as unknown", () => {
    const url = new URL(bookingLink(base, { name: "   " }));
    expect(url.searchParams.has("name")).toBe(false);
  });

  it("keeps params the tenant put in the link themselves", () => {
    const url = new URL(bookingLink(`${base}?name=קבוע&month=2026-09`, { name: "ניר" }));
    expect(url.searchParams.get("name")).toBe("קבוע");
    expect(url.searchParams.get("month")).toBe("2026-09");
  });

  it("keeps a Hebrew Cal.com handle readable in the chat", () => {
    const link = bookingLink("https://cal.com/ניר-סבאן-zgtxlf/20min", { name: "ניר" });
    expect(link).toContain("https://cal.com/ניר-סבאן-zgtxlf/20min?");
    // Still the same URL once a client encodes it.
    expect(new URL(link).pathname).toBe(new URL("https://cal.com/ניר-סבאן-zgtxlf/20min").pathname);
  });

  it("passes a non-URL through untouched rather than breaking the message", () => {
    expect(bookingLink("cal.com/eden", { name: "ניר" })).toBe("cal.com/eden");
  });
});
