/**
 * Building the tenant's own Cal.com link for a specific lead (pure).
 *
 * Kept next to the scheduling engine rather than in the worker so it can be
 * tested without Prisma, and so the web app can reuse it if a booking link ever
 * goes out from the dashboard.
 */

/**
 * The query key Cal.com hands straight back to us on the booking webhook.
 *
 * Cal.com collects every `metadata[...]` query param on the booking page and
 * returns them as `payload.metadata` — it is the one field we control end to
 * end, it needs no event-type configuration, and the lead never sees it. The
 * webhook reads it back through `bookerContactId`.
 */
export const CONTACT_METADATA_KEY = "kesherContactId";

export interface BookingLinkLead {
  /** Our contact id — round-trips through Cal.com and identifies the booker. */
  contactId?: string | null;
  name?: string | null;
  /** Digits only, country code first ("972501234567") — or null if unknown. */
  phone?: string | null;
}

/**
 * The Cal.com link, carrying everything we know about the lead.
 *
 * Cal.com's booking form is the only place the two systems meet, and by default
 * it asks for a name and an email — neither of which the Cal.com webhook can
 * match back to a WhatsApp contact. A booking whose payload carries no phone and
 * a name the lead retyped (a contact saved as "ניר" booking as "Nir Saban")
 * arrives unidentified: the meeting is recorded, but the lead is never told it
 * is set, because confirming to a merely *guessed* contact is worse than
 * staying quiet.
 *
 * So the link carries the contact id in `metadata[…]`, which comes back on the
 * webhook untouched. Name and phone are prefilled too — they are what the lead
 * actually sees, and they keep the booking readable in Cal.com itself. Params
 * whose field the form does not have are ignored (`attendeePhoneNumber` is
 * hidden unless the event type enables it, `smsReminderNumber` exists only with
 * an SMS workflow), which is exactly why the id does not rely on them.
 */
export function bookingLink(base: string, lead: BookingLinkLead): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return base; // the tenant typed something that isn't a URL — send it as-is
  }

  // Never clobber a param the tenant put in the link themselves.
  const set = (key: string, value: string) => {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  };

  if (lead.contactId) set(`metadata[${CONTACT_METADATA_KEY}]`, lead.contactId);

  const name = lead.name?.trim();
  if (name) set("name", name);

  if (lead.phone) {
    // Cal.com's phone inputs want E.164.
    const e164 = `+${lead.phone}`;
    // The dedicated attendee-phone question and the SMS-reminder question are
    // different fields on different event types; whichever exists gets filled.
    set("attendeePhoneNumber", e164);
    set("smsReminderNumber", e164);
  }

  // Cal.com reads the metadata key literally (it strips "metadata[" and "]"),
  // and URLSearchParams would hand it percent-encoded brackets. Both forms
  // decode identically, but literal brackets are what the docs show and what a
  // tenant pasting the link will recognise.
  url.search = url.search.replace(/%5B/g, "[").replace(/%5D/g, "]");
  return url.toString();
}
