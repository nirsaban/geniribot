import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, type Prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(d);
}

function fieldsSummary(fields: unknown): string {
  if (!fields || typeof fields !== "object") return "";
  const entries = Object.entries(fields as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { q } = await searchParams;

  const where: Prisma.ContactWhereInput = { organizationId: session.org };
  if (q && q.trim()) {
    const term = q.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
    ];
  }

  const contacts = await prisma.contact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link href="/dashboard" className="text-sm text-brand">
        {he.backToDashboard}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-brand-dark">{he.leadsTitle}</h1>
      <p className="mb-6 text-sm text-gray-500">{he.leadsSubtitle}</p>

      <form className="mb-6">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder={he.searchLeads}
          className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-brand"
        />
      </form>

      {contacts.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
          {he.noLeads}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className="border-b border-gray-100 text-gray-500">
              <tr>
                <th className="p-3 font-medium">{he.colName}</th>
                <th className="p-3 font-medium">{he.colPhone}</th>
                <th className="p-3 font-medium">{he.colTags}</th>
                <th className="p-3 font-medium">{he.colFields}</th>
                <th className="p-3 font-medium">{he.colCreated}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="p-3">
                    <Link href={`/dashboard/leads/${c.id}`} className="font-medium text-brand">
                      {c.name || "—"}
                    </Link>
                  </td>
                  <td className="p-3 text-gray-600" dir="ltr">
                    {c.phone}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="max-w-xs truncate p-3 text-gray-500">{fieldsSummary(c.fields)}</td>
                  <td className="p-3 text-gray-400">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
