import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole, type Role } from "@kesher/core";
import { prisma } from "@kesher/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { contactsLimitReached } from "@/lib/plan";
import { getSession } from "@/lib/session";
import type { FieldSpec } from "@kesher/flow-engine";
import {
  buildLeadWhere,
  callbackPhone,
  formatFieldValue,
  isHiddenNumber,
  isLeadSort,
  LEAD_SORTS,
  LEAD_STATUSES,
  loadScenarioSchemas,
  statusTone,
  type LeadFilters,
} from "@/lib/leads";
import { bulkAction } from "./actions";
import { BulkBar } from "./BulkBar";
import { RowLink } from "./RowLink";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const BULK_FORM = "leads-bulk";

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(d);
}

type Params = LeadFilters & { sort?: string; page?: string };

/**
 * A LID contact has no dialable number, so show what it actually is rather than
 * printing an opaque id under a "phone" heading. When the scenario asked the
 * lead for a phone, that answer is the real number and is shown instead.
 */
function PhoneCell({
  contact,
  specs,
}: {
  contact: { phone: string; waJid: string | null; fields: unknown };
  specs: FieldSpec[];
}) {
  if (!isHiddenNumber(contact)) {
    return <span dir="ltr">{contact.phone}</span>;
  }
  const given = callbackPhone(contact.fields, specs);
  if (given) {
    return <span dir="ltr">{given}</span>;
  }
  return (
    <span className="badge-gray" title={he.hiddenNumberHint}>
      🔒 {he.hiddenNumber}
    </span>
  );
}

/** Preserve the active filters when linking to export / other pages. */
function queryString(params: Params, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...extra })) {
    if (v) qs.set(k, String(v));
  }
  return qs.toString();
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;

  const viewer = { userId: session.sub, role: session.role as Role };
  const where = buildLeadWhere(session.org, params, viewer);
  const isAgent = !hasRole(viewer.role, "ADMIN");
  const sort = isLeadSort(params.sort) ? params.sort : "new";
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const [total, contacts, members, scenarios, tagRows, atContactsLimit] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy: LEAD_SORTS[sort],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { owner: { select: { id: true, name: true, email: true } } },
    }),
    prisma.user.findMany({
      where: { organizationId: session.org },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
    loadScenarioSchemas(session.org),
    // Scoped the same way, so the tag filter never hints at leads the viewer
    // cannot open.
    prisma.contact.findMany({
      where: buildLeadWhere(session.org, {}, viewer),
      select: { tags: true },
    }),
    contactsLimitReached(session.org),
  ]);

  const allTags = [...new Set(tagRows.flatMap((r) => r.tags))].sort();
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const memberName = (m: { name: string | null; email: string }) => m.name || m.email;

  // One lookup of every field spec across scenarios, so a lead's answers can be
  // labelled even when it came from a different flow than the one being viewed.
  const specByKey = new Map(scenarios.flatMap((s) => s.fields).map((f) => [f.key, f]));

  const answersSummary = (fields: unknown): string => {
    if (!fields || typeof fields !== "object") return "";
    return Object.entries(fields as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .slice(0, 3)
      .map(([k, v]) => {
        const spec = specByKey.get(k);
        return `${spec?.label ?? k}: ${formatFieldValue(spec, v)}`;
      })
      .join(" · ");
  };

  const hasFilters = Boolean(
    params.q ||
      params.status ||
      params.owner ||
      params.flow ||
      params.tag ||
      params.from ||
      params.to ||
      params.stale,
  );

  return (
    <>
      <PageHeader
        title={he.leadsTitle}
        subtitle={he.leadsSubtitle}
        action={
          total > 0 ? (
            <a className="btn-secondary btn-sm" href={`/dashboard/leads/export?${queryString(params)}`}>
              ⬇ {he.exportCsv}
            </a>
          ) : undefined
        }
      />

      {atContactsLimit && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {he.contactsLimitReached}{" "}
          <a href="/dashboard/billing" className="font-semibold underline">
            {he.featureLockedCta}
          </a>
        </div>
      )}

      {/* Filters — a plain GET form, so every filter state is a shareable URL. */}
      <Card className="mb-5">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="q">
              {he.filters}
            </label>
            <input
              id="q"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder={he.searchLeads}
              className="input"
            />
          </div>

          <div>
            <label className="label" htmlFor="status">
              {he.filterStatus}
            </label>
            <select id="status" name="status" defaultValue={params.status ?? ""} className="input">
              <option value="">{he.anyValue}</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {he.leadStatus[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="owner">
              {he.filterOwner}
            </label>
            <select id="owner" name="owner" defaultValue={params.owner ?? ""} className="input">
              <option value="">{he.anyValue}</option>
              <option value="none">{he.unassigned}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {memberName(m)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="flow">
              {he.filterScenario}
            </label>
            <select id="flow" name="flow" defaultValue={params.flow ?? ""} className="input">
              <option value="">{he.anyValue}</option>
              <option value="none">{he.sourceNone}</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="tag">
              {he.filterTag}
            </label>
            <select id="tag" name="tag" defaultValue={params.tag ?? ""} className="input">
              <option value="">{he.anyValue}</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="from">
              {he.filterFrom}
            </label>
            <input id="from" type="date" name="from" defaultValue={params.from ?? ""} className="input" />
          </div>

          <div>
            <label className="label" htmlFor="to">
              {he.filterTo}
            </label>
            <input id="to" type="date" name="to" defaultValue={params.to ?? ""} className="input" />
          </div>

          <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                name="stale"
                value="1"
                defaultChecked={params.stale === "1"}
                className="h-4 w-4 rounded border-line accent-brand"
              />
              {he.filterStale}
            </label>
            <select name="sort" defaultValue={sort} aria-label={he.sortLabel} className="input max-w-[11rem]">
              <option value="new">{he.sortNewest}</option>
              <option value="old">{he.sortOldest}</option>
              <option value="recent">{he.sortActivity}</option>
              <option value="updated">{he.sortUpdated}</option>
            </select>
            <button className="btn-primary btn-sm" type="submit">
              {he.applyFilters}
            </button>
            {hasFilters && (
              <a className="btn-ghost btn-sm" href="/dashboard/leads">
                {he.clearFilters}
              </a>
            )}
          </div>
        </form>
      </Card>

      {contacts.length === 0 ? (
        <EmptyState icon="👥" title={hasFilters ? he.noResults : he.noLeads} />
      ) : (
        <form id={BULK_FORM} action={bulkAction}>
          {/* Bulk toolbar */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <BulkBar formId={BULK_FORM} />
            <div className="flex flex-wrap items-center gap-2">
              <select name="statusValue" defaultValue="" className="input btn-sm max-w-[11rem]">
                <option value="">{he.bulkStatus}</option>
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {he.leadStatus[s]}
                  </option>
                ))}
              </select>
              <button className="btn-secondary btn-sm" name="op" value="status" type="submit">
                {he.bulkApply}
              </button>
              {/* An agent may claim leads or release them, but not hand them to
                  someone else — the action enforces this too. */}
              <select name="ownerValue" defaultValue="" className="input btn-sm max-w-[11rem]">
                <option value="">{he.unassigned}</option>
                {(isAgent ? members.filter((m) => m.id === session.sub) : members).map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberName(m)}
                  </option>
                ))}
              </select>
              <button className="btn-secondary btn-sm" name="op" value="owner" type="submit">
                {he.bulkAssign}
              </button>
            </div>
          </div>

          {/* Desktop: full table. */}
          <Card className="!p-0 hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b border-line text-xs text-slate-400">
                  <tr>
                    <th className="w-10 p-3" />
                    <th className="p-3 font-medium">{he.colName}</th>
                    <th className="p-3 font-medium">{he.colPhone}</th>
                    <th className="p-3 font-medium">{he.colStatus}</th>
                    <th className="p-3 font-medium">{he.colOwner}</th>
                    <th className="p-3 font-medium">{he.colSource}</th>
                    <th className="p-3 font-medium">{he.colFields}</th>
                    <th className="p-3 font-medium">{he.colCreated}</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <RowLink
                      as="tr"
                      key={c.id}
                      href={`/dashboard/leads/${c.id}`}
                      className="border-b border-line/60 last:border-0 hover:bg-slate-50"
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          name="ids"
                          value={c.id}
                          aria-label={c.name ?? c.phone}
                          className="h-4 w-4 rounded border-line accent-brand"
                        />
                      </td>
                      <td className="p-3">
                        <Link
                          href={`/dashboard/leads/${c.id}`}
                          className="flex items-center gap-2 font-medium text-ink"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand-dark">
                            {(c.name ?? "?").slice(0, 1)}
                          </span>
                          {c.name || "—"}
                        </Link>
                      </td>
                      <td className="p-3 text-slate-500">
                        <PhoneCell contact={c} specs={[...specByKey.values()]} />
                      </td>
                      <td className="p-3">
                        <Badge tone={statusTone(c.status)}>{he.leadStatus[c.status]}</Badge>
                      </td>
                      <td className="p-3 text-slate-500">
                        {c.owner ? memberName(c.owner) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="p-3">
                        {c.source ? (
                          <span className="badge-brand" title={c.source}>
                            ⚡ {c.source.slice(0, 16)}
                          </span>
                        ) : (
                          <span className="badge-gray">{he.sourceNone}</span>
                        )}
                      </td>
                      <td className="max-w-xs truncate p-3 text-slate-400">{answersSummary(c.fields)}</td>
                      <td className="whitespace-nowrap p-3 text-slate-400">{fmtDate(c.createdAt)}</td>
                    </RowLink>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile: the same rows as cards. A 8-column table cannot be made
              readable at 375px, and horizontal scrolling hides the columns that
              matter most (status, owner). */}
          <div className="grid gap-3 md:hidden">
            {contacts.map((c) => (
              <RowLink as="div" key={c.id} href={`/dashboard/leads/${c.id}`} className="card p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="ids"
                    value={c.id}
                    aria-label={c.name ?? c.phone}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-line accent-brand"
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/leads/${c.id}`} className="font-semibold text-ink">
                      {c.name || "—"}
                    </Link>
                    <div className="mt-0.5 text-sm text-slate-500">
                      <PhoneCell contact={c} specs={[...specByKey.values()]} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone={statusTone(c.status)}>{he.leadStatus[c.status]}</Badge>
                      {c.owner ? (
                        <span className="badge-gray">{memberName(c.owner)}</span>
                      ) : (
                        <span className="badge-gray">{he.unassigned}</span>
                      )}
                      {c.source && <span className="badge-brand">⚡ {c.source.slice(0, 14)}</span>}
                    </div>
                    {answersSummary(c.fields) && (
                      <p className="mt-2 line-clamp-2 text-xs text-slate-400">{answersSummary(c.fields)}</p>
                    )}
                    <div className="mt-2 text-xs text-slate-400">{fmtDate(c.createdAt)}</div>
                  </div>
                </div>
              </RowLink>
            ))}
          </div>
        </form>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="mt-5 flex items-center justify-between text-sm text-slate-500">
          <span>
            {he.showing} {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} {he.of} {total}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a className="btn-secondary btn-sm" href={`?${queryString(params, { page: String(page - 1) })}`}>
                {he.prevPage}
              </a>
            )}
            {page < pageCount && (
              <a className="btn-secondary btn-sm" href={`?${queryString(params, { page: String(page + 1) })}`}>
                {he.nextPage}
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
