import { deriveFieldSchema, parseFieldSchema, type FieldSpec } from "@kesher/flow-engine";
import { FlowDefinition } from "@kesher/flow-engine";
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

/** Filter state, parsed straight from the URL's search params. */
export interface LeadFilters {
  q?: string;
  status?: string;
  owner?: string;
  flow?: string;
  tag?: string;
  from?: string;
  to?: string;
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

/**
 * Translate URL filters into a Prisma `where`.
 *
 * Shared by the list page and the CSV export so "export" always means "exactly
 * the rows you are looking at" — if these drifted apart the export would
 * silently include leads the user had filtered out.
 */
export function buildLeadWhere(organizationId: string, f: LeadFilters): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { organizationId };

  const term = f.q?.trim();
  if (term) {
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
      { callSummary: { contains: term, mode: "insensitive" } },
    ];
  }
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
