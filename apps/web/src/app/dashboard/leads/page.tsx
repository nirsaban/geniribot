import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, type Prisma } from "@kesher/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(d);
}

function fieldsSummary(fields: unknown): string {
  if (!fields || typeof fields !== "object") return "";
  return Object.entries(fields as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scenario?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { q, scenario } = await searchParams;

  const where: Prisma.ContactWhereInput = { organizationId: session.org };
  if (q?.trim()) {
    const term = q.trim();
    where.OR = [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }];
  }
  if (scenario === "1") where.source = { not: null };

  const contacts = await prisma.contact.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });

  return (
    <>
      <PageHeader title={he.leadsTitle} subtitle={he.leadsSubtitle} />

      <form className="mb-5 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder={he.searchLeads} className="input max-w-xs" />
        <div className="flex rounded-xl border border-line bg-white p-0.5 text-sm">
          <a href="?" className={`rounded-lg px-3 py-1.5 ${scenario !== "1" ? "bg-brand text-white" : "text-slate-500"}`}>{he.filterAll}</a>
          <a href="?scenario=1" className={`rounded-lg px-3 py-1.5 ${scenario === "1" ? "bg-brand text-white" : "text-slate-500"}`}>{he.filterScenarioOnly}</a>
        </div>
      </form>

      {contacts.length === 0 ? (
        <EmptyState icon="👥" title={he.noLeads} />
      ) : (
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-line text-xs text-slate-400">
                <tr>
                  <th className="p-3 font-medium">{he.colName}</th>
                  <th className="p-3 font-medium">{he.colPhone}</th>
                  <th className="p-3 font-medium">{he.colSource}</th>
                  <th className="p-3 font-medium">{he.colTags}</th>
                  <th className="p-3 font-medium">{he.colFields}</th>
                  <th className="p-3 font-medium">{he.colCreated}</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-line/60 last:border-0 hover:bg-slate-50">
                    <td className="p-3">
                      <Link href={`/dashboard/leads/${c.id}`} className="flex items-center gap-2 font-medium text-ink">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand-dark">
                          {(c.name ?? "?").slice(0, 1)}
                        </span>
                        {c.name || "—"}
                      </Link>
                    </td>
                    <td className="p-3 text-slate-500" dir="ltr">{c.phone}</td>
                    <td className="p-3">
                      {c.source ? (
                        <span className="badge-brand" title={c.source}>⚡ {c.source.slice(0, 16)}</span>
                      ) : (
                        <span className="badge-gray">{he.sourceNone}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((t) => <span key={t} className="badge-gray">{t}</span>)}
                      </div>
                    </td>
                    <td className="max-w-xs truncate p-3 text-slate-400">{fieldsSummary(c.fields)}</td>
                    <td className="p-3 text-slate-400">{fmtDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
