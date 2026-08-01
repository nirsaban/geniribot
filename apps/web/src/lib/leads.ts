import { deriveFieldSchema, parseFieldSchema, type FieldSpec } from "@kesher/flow-engine";
import { FlowDefinition } from "@kesher/flow-engine";
import { hasRole, type Role } from "@kesher/core";
import type { LeadStatus, Prisma } from "@kesher/db";
import { prisma } from "@kesher/db";

/** Pipeline order — also the order status filters and menus are rendered in. */
export const LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "MEETING_SET",
  "WON",
  "LOST",
];

/** Badge tone per status; WON/LOST are the only ones that read as terminal. */
export function statusTone(status: LeadStatus): "brand" | "gray" | "green" | "amber" | "red" {
  switch (status) {
    case "NEW":
      return "brand";
    case "CONTACTED":
      return "gray";
    case "QUALIFIED":
      return "amber";
    case "MEETING_SET":
      return "amber";
    case "WON":
      return "green";
    case "LOST":
      return "red";
  }
}

/**
 * The field set for a flow: the persisted schema when present, otherwise
 * derived on the fly.
 *
 * The fallback matters for flows saved before `fieldSchema` existed — without
 * it their leads' answers would render as raw keys until someone happened to
 * re-save the flow.
 */
export function schemaOf(flow: { definition: unknown; fieldSchema: unknown }): FieldSpec[] {
  const persisted = parseFieldSchema(flow.fieldSchema);
  if (persisted) return persisted;
  const parsed = FlowDefinition.safeParse(flow.definition);
  return parsed.success ? deriveFieldSchema(parsed.data) : [];
}

export interface ScenarioSchema {
  id: string;
  name: string;
  fields: FieldSpec[];
}

/** Every scenario in the org with its canonical field set, for CRM rendering. */
export async function loadScenarioSchemas(organizationId: string): Promise<ScenarioSchema[]> {
  const flows = await prisma.flow.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, definition: true, fieldSchema: true },
  });
  return flows.map((f) => ({ id: f.id, name: f.name, fields: schemaOf(f) }));
}

/**
 * Render one collected answer for display, using the field's declared type.
 * Values arrive from a JSON bag so anything can be in there — never assume.
 */
export function formatFieldValue(spec: FieldSpec | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (spec?.expect === "date") {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" }).format(d);
    }
  }
  if (spec?.expect === "number" && typeof value === "number") {
    return new Intl.NumberFormat("he-IL").format(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Prefix for the collected-field inputs on the lead page.
 *
 * The bag's keys are typed free-hand in the bot builder, so an unprefixed input
 * named "id" or "op" would collide with the form's own control fields.
 */
export const FIELD_INPUT = "f:";

/**
 * The options a choice field offers, keeping whatever the lead already has.
 *
 * A scenario can be edited after leads answered it, so the stored value is not
 * always still on the list. Dropping it would mean opening the lead and saving
 * anything silently rewrites an answer the lead actually gave, so it stays as a
 * first option instead.
 */
export function choiceOptions(spec: FieldSpec, value: unknown): string[] {
  const declared = spec.choices ?? [];
  const current = value === null || value === undefined ? "" : String(value);
  return current && !declared.includes(current) ? [current, ...declared] : declared;
}

/** How many distinct past answers one field may offer as suggestions. */
const SUGGEST_MAX = 25;
/** Past answers longer than this are prose, not a reusable option. */
const SUGGEST_LEN = 60;

/**
 * The answers other leads already gave, per field.
 *
 * Most scenarios ask their questions as free text — the bot has to accept
 * whatever someone types on WhatsApp — so a "choice" list rarely exists even
 * when the answers are in practice a short repeating set ("אסיאתית", "כן",
 * "ראש פינה"). Offering what has been recorded before turns editing into
 * picking, and keeps spellings consistent across the CRM, without forbidding a
 * value nobody has used yet.
 */
export function suggestionsByField(
  rows: { fields: unknown }[],
  keys: string[],
): Map<string, string[]> {
  const seen = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]));
  for (const row of rows) {
    if (!row.fields || typeof row.fields !== "object") continue;
    const bag = row.fields as Record<string, unknown>;
    for (const key of keys) {
      const set = seen.get(key)!;
      if (set.size >= SUGGEST_MAX) continue;
      const v = bag[key];
      if (v === null || v === undefined || typeof v === "object") continue;
      const s = String(v).trim();
      if (s && s.length <= SUGGEST_LEN) set.add(s);
    }
  }
  return new Map(
    [...seen].map(([k, set]) => [k, [...set].sort((a, b) => a.localeCompare(b, "he"))]),
  );
}

/** One collected value as the string its form control holds. */
export function fieldInputValue(spec: FieldSpec | undefined, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (spec?.expect === "date") {
    // <input type="date"> only accepts yyyy-mm-dd, so a stored timestamp is
    // narrowed to the day. What cannot be parsed at all is left verbatim for
    // `fieldInputType` to fall back to a text box over.
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * True when `<input type=…>` can actually display `s`.
 *
 * `number` and `date` inputs refuse anything they cannot parse: the browser
 * shows an empty box and reports an empty value, so the answer would be gone
 * the next time the form is saved. Only those two sanitise their value —
 * `email` and `tel` merely flag what looks wrong, and still show it.
 */
function representable(type: string, s: string): boolean {
  if (s === "") return true;
  if (type === "number") return /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s);
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(s);
  return true;
}

/**
 * The HTML input type to edit a field with.
 *
 * Declared expectation first — a number question deserves a numeric keypad —
 * but never at the cost of the answer itself. The bot accepts whatever the lead
 * typed on WhatsApp, so a question expecting a number holds "בערך 5000" often
 * enough, and a typed input would silently swallow it. Such a value is edited
 * as plain text, which is exactly how it was collected.
 */
export function fieldInputType(spec: FieldSpec | undefined, value: unknown): string {
  const want = (() => {
    switch (spec?.expect) {
      case "number":
        return "number";
      case "date":
        return "date";
      case "email":
        return "email";
      case "phone":
        return "tel";
      default:
        return "text";
    }
  })();
  return representable(want, fieldInputValue(spec, value)) ? want : "text";
}

/**
 * Parse one submitted field back into the value stored in the JSON bag.
 * Returns null for "cleared", so the caller can drop the key rather than
 * leaving an empty string behind.
 */
export function parseFieldInput(spec: FieldSpec | undefined, raw: string): string | number | null {
  const v = raw.trim();
  if (!v) return null;
  if (spec?.expect === "number") {
    // Keep the text when it is not really a number — a bot answer like
    // "בערך 5000" is still the lead's answer, and destroying it is worse than
    // storing it untyped.
    const n = Number(v.replace(/[\s,]/g, ""));
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

/**
 * True when `Contact.phone` holds a WhatsApp LID rather than a real number.
 *
 * LID ("hidden number") senders arrive as an opaque id like
 * `14396898152593@lid`, and the user part of that is what lands in `phone`.
 * Rendering it in a column headed "טלפון" is simply wrong — it is not a number
 * anyone can dial, and it is not derived from one.
 */
export function isHiddenNumber(contact: { phone: string; waJid?: string | null }): boolean {
  // Judged on the stored number itself, deliberately not on `waJid`. Once a LID
  // chat has been resolved to a real number, `phone` holds that number while
  // `waJid` still ends in @lid — that is the address we reply to, and says
  // nothing about whether we know the person's phone number.
  //
  // Israeli numbers are 12 digits (972…) and international ones run to 13; the
  // LIDs WhatsApp issues are 14–15, so the threshold sits in that gap.
  // Imperfect: a genuine 14-digit international number would be mislabelled.
  // That is the safer direction to err — calling a real number "hidden" is a
  // visible annoyance, whereas printing a LID as a phone number sends someone
  // off to dial digits that were never a phone number.
  return contact.phone.replace(/\D/g, "").length > 13;
}

/**
 * A number the lead actually gave us, if the scenario asked for one.
 *
 * Any question declared `expect: "phone"` counts — which is the whole point of
 * the per-scenario field schema: we do not need to guess at key names.
 */
export function callbackPhone(
  fields: unknown,
  specs: FieldSpec[],
): string | null {
  if (!fields || typeof fields !== "object") return null;
  const bag = fields as Record<string, unknown>;
  for (const spec of specs) {
    if (spec.expect !== "phone") continue;
    const v = bag[spec.key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** Filter state, parsed straight from the URL's search params. */
export interface LeadFilters {
  q?: string;
  status?: string;
  owner?: string;
  flow?: string;
  product?: string;
  tag?: string;
  from?: string;
  to?: string;
  /** "1" = only leads going cold (see STALE_DAYS). */
  stale?: string;
}

/**
 * How long a lead may sit without contact before it counts as going cold.
 * Deliberately short: these are WhatsApp leads who just raised their hand, and
 * a week of silence is already a lost sale.
 */
export const STALE_DAYS = 7;

/** Leads still in play that nobody has touched recently. */
export function staleWhere(): Prisma.ContactWhereInput {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  return {
    status: { notIn: ["WON", "LOST"] },
    // A lead the bot never reached is stale from creation, so a null
    // lastContactedAt counts too rather than being silently excluded.
    OR: [{ lastContactedAt: { lt: cutoff } }, { lastContactedAt: null, createdAt: { lt: cutoff } }],
  };
}

/** Sort options exposed in the list header. */
export const LEAD_SORTS = {
  new: { createdAt: "desc" },
  old: { createdAt: "asc" },
  recent: { lastContactedAt: "desc" },
  updated: { updatedAt: "desc" },
} satisfies Record<string, Prisma.ContactOrderByWithRelationInput>;

export type LeadSort = keyof typeof LEAD_SORTS;

export function isLeadSort(v: string | undefined): v is LeadSort {
  return !!v && v in LEAD_SORTS;
}

/** Who is looking — determines which leads are visible at all. */
export interface LeadViewer {
  userId: string;
  role: Role;
}

/**
 * Row-level visibility.
 *
 * An AGENT sees the leads assigned to them plus the unassigned pool, so new
 * leads stay claimable by whoever gets to them first; ADMIN and OWNER see
 * everything. Returns null when there is no restriction.
 *
 * This is a `where` fragment rather than a UI concern on purpose — it has to
 * apply identically to the list, the CSV export, the detail page and every
 * mutation, and the only way to guarantee that is to make it part of the query.
 */
export function leadVisibility(viewer: LeadViewer | undefined): Prisma.ContactWhereInput | null {
  if (!viewer || hasRole(viewer.role, "ADMIN")) return null;
  return { OR: [{ ownerUserId: viewer.userId }, { ownerUserId: null }] };
}

/**
 * Translate URL filters into a Prisma `where`.
 *
 * Shared by the list page and the CSV export so "export" always means "exactly
 * the rows you are looking at" — if these drifted apart the export would
 * silently include leads the user had filtered out.
 *
 * Both the search terms and the visibility rule need an OR, so they are
 * combined under AND: assigning `where.OR` twice would silently drop whichever
 * came first, and if visibility lost that race an agent would see every lead
 * the moment they typed in the search box.
 */
export function buildLeadWhere(
  organizationId: string,
  f: LeadFilters,
  viewer?: LeadViewer,
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { organizationId };
  const and: Prisma.ContactWhereInput[] = [];

  const visibility = leadVisibility(viewer);
  if (visibility) and.push(visibility);

  const term = f.q?.trim();
  if (term) {
    and.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { phone: { contains: term } },
        { callSummary: { contains: term, mode: "insensitive" } },
      ],
    });
  }
  // Also an OR, so it joins the AND list rather than overwriting the others.
  if (f.stale === "1") and.push(staleWhere());
  if (and.length > 0) where.AND = and;

  if (f.status && LEAD_STATUSES.includes(f.status as LeadStatus)) {
    where.status = f.status as LeadStatus;
  }
  // "unassigned" is a real filter choice, distinct from "any owner".
  if (f.owner === "none") where.ownerUserId = null;
  else if (f.owner) where.ownerUserId = f.owner;

  if (f.flow === "none") where.sourceFlowId = null;
  else if (f.flow) where.sourceFlowId = f.flow;

  if (f.product === "none") where.productId = null;
  else if (f.product) where.productId = f.product;

  if (f.tag) where.tags = { has: f.tag };

  const from = f.from ? new Date(f.from) : null;
  const to = f.to ? new Date(f.to) : null;
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
    where.createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      // `to` is a date, and the user means the whole of that day.
      ...(to && !Number.isNaN(to.getTime())
        ? { lt: new Date(to.getTime() + 24 * 60 * 60 * 1000) }
        : {}),
    };
  }
  return where;
}

/**
 * Serialize rows to CSV.
 *
 * Prefixed with a UTF-8 BOM because Excel on Hebrew Windows otherwise reads the
 * file as the local ANSI codepage and mojibakes every Hebrew column — the
 * single most likely way this export gets reported as broken.
 */
export function toCsv(headers: string[], rows: string[][]): string {
  const escape = (cell: string): string => {
    const v = cell ?? "";
    // Guard against CSV injection: a leading =/+/-/@ is executed by Excel.
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [headers, ...rows].map((r) => r.map(escape).join(","));
  return `﻿${lines.join("\r\n")}`;
}
