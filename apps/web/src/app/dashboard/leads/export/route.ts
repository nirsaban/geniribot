import { NextResponse } from "next/server";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import {
  buildLeadWhere,
  formatFieldValue,
  isLeadSort,
  LEAD_SORTS,
  loadScenarioSchemas,
  toCsv,
  type LeadFilters,
} from "@/lib/leads";

export const dynamic = "force-dynamic";

/**
 * Export the currently filtered leads as CSV.
 *
 * Reuses `buildLeadWhere`, so the file always contains exactly the rows the
 * list is showing. Capped rather than streamed: an org with more leads than
 * this should be querying the database directly, and an unbounded export is an
 * easy way to exhaust the server's memory.
 */
const MAX_ROWS = 5000;

export async function GET(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams) as LeadFilters & { sort?: string };
  const where = buildLeadWhere(session.org, params);
  const sort = isLeadSort(params.sort) ? params.sort : "new";

  const [contacts, scenarios] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: LEAD_SORTS[sort],
      take: MAX_ROWS,
      include: { owner: { select: { name: true, email: true } } },
    }),
    loadScenarioSchemas(session.org),
  ]);

  // Every bot-collected field across all scenarios becomes a column, so leads
  // from different flows line up in one sheet instead of one column of blobs.
  const specs = [...new Map(scenarios.flatMap((s) => s.fields).map((f) => [f.key, f])).values()];

  const headers = [
    he.colName,
    he.colPhone,
    he.colStatus,
    he.colOwner,
    he.colSource,
    he.colCreated,
    he.callSummaryTitle,
    he.colTags,
    ...specs.map((f) => f.label),
  ];

  const fmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

  const rows = contacts.map((c) => {
    const fields = (c.fields ?? {}) as Record<string, unknown>;
    return [
      c.name ?? "",
      c.phone,
      he.leadStatus[c.status],
      c.owner ? (c.owner.name ?? c.owner.email) : "",
      c.source ?? "",
      fmt.format(c.createdAt),
      c.callSummary ?? "",
      c.tags.join(" | "),
      ...specs.map((f) => formatFieldValue(f, fields[f.key])),
    ];
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
