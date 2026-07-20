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
 * True when `Contact.phone` holds a WhatsApp LID rather than a real number.
 *
 * LID ("hidden number") senders arrive as an opaque id like
 * `14396898152593@lid`, and the user part of that is what lands in `phone`.
 * Rendering it in a column headed "טלפון" is simply wrong — it is not a number
 * anyone can dial, and it is not derived from one.
 */
export function isHiddenNumber(contact: { phone: string; waJid?: string | null }): boolean {
  // Exact for anything stored since waJid was added.
  if (contact.waJid) return contact.waJid.endsWith("@lid");

  // Older rows have no waJid, so fall back to length. Israeli numbers are 12
  // digits (972…) and international ones run to 13; the LIDs WhatsApp issues
  // are 14–15. The threshold sits in that gap.
  //
  // Imperfect by nature: a genuine 14-digit international number would be
  // mislabelled. That is the safer direction to err — calling a real number
  // "hidden" is a visible annoyance, whereas printing a LID as a phone number
  // sends someone off to dial digits that were never a phone number.
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
