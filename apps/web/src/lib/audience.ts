import "server-only";
import type { LeadStatus } from "@kesher/db";
import { prisma } from "@kesher/db";
import { LEAD_STATUSES } from "@/lib/leads";

/** One resolved recipient, deduped by normalized phone. */
export interface Recipient {
  phone: string;
  name: string | null;
  contactId: string | null;
}

/**
 * Normalize anything phone-shaped to digits with a country code.
 * Israeli local format (05x-…) becomes 972…; anything else keeps its digits.
 * Returns null when it can't be a phone number.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = `972${digits.slice(1)}`;
  return digits.length >= 9 && digits.length <= 15 ? digits : null;
}

/**
 * Parse a recipients CSV: first column phone, optional second column name.
 * Handles comma/semicolon/tab delimiters and skips a header row (a first row
 * whose first cell has no digits can't be a phone number).
 */
export function parseRecipientsCsv(text: string): Array<{ phone: string; name: string | null }> {
  const out: Array<{ phone: string; name: string | null }> = [];
  const lines = text.split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    const delim = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
    const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
    const phone = normalizePhone(cells[0] ?? "");
    if (!phone) {
      if (i === 0) continue; // header row
      continue; // unparseable line — skip rather than poison the batch
    }
    out.push({ phone, name: cells[1]?.trim() || null });
  }
  return out;
}

/**
 * Build the recipient set from one submitted audience form. Three sources,
 * unioned and deduped by phone (first occurrence wins, so a CRM lead's name
 * beats a CSV row's blank one):
 *  - CRM leads (all, or filtered by status/tag)
 *  - manually typed numbers
 *  - an uploaded CSV
 */
export async function collectAudience(
  organizationId: string,
  formData: FormData,
): Promise<Recipient[]> {
  const byPhone = new Map<string, Recipient>();
  const add = (r: Recipient) => {
    if (!byPhone.has(r.phone)) byPhone.set(r.phone, r);
  };

  if (formData.get("includeLeads") === "1") {
    const status = String(formData.get("leadStatus") ?? "");
    const tag = String(formData.get("leadTag") ?? "");
    const contacts = await prisma.contact.findMany({
      where: {
        organizationId,
        ...(status && LEAD_STATUSES.includes(status as LeadStatus)
          ? { status: status as LeadStatus }
          : {}),
        ...(tag ? { tags: { has: tag } } : {}),
      },
      select: { id: true, phone: true, name: true },
    });
    for (const c of contacts) {
      const phone = normalizePhone(c.phone);
      // Skip LID pseudo-numbers — they are not routable phone numbers.
      if (phone && phone.length <= 13) add({ phone, name: c.name, contactId: c.id });
    }
  }

  const manual = String(formData.get("manualPhones") ?? "");
  for (const part of manual.split(/[,\n]/)) {
    const phone = normalizePhone(part);
    if (phone) add({ phone, name: null, contactId: null });
  }

  const file = formData.get("csv");
  if (file instanceof File && file.size > 0) {
    const text = await file.text();
    for (const row of parseRecipientsCsv(text)) {
      add({ phone: row.phone, name: row.name, contactId: null });
    }
  }

  return [...byPhone.values()];
}
