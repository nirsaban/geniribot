import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const DAY = 86400000;

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [org, contacts, upcomingAppts, convos, connections] = await Promise.all([
    prisma.organization.findUnique({ where: { id: session.org } }),
    prisma.contact.findMany({
      where: { organizationId: session.org },
      orderBy: { createdAt: "desc" },
    }),
    prisma.appointment.count({
      where: { organizationId: session.org, startsAt: { gte: new Date() }, status: { in: ["BOOKED", "CONFIRMED"] } },
    }),
    prisma.conversation.findMany({ where: { organizationId: session.org }, select: { status: true } }),
    prisma.whatsAppConnection.count({ where: { organizationId: session.org, status: "CONNECTED" } }),
  ]);
  if (!org) redirect("/login");

  const now = Date.now();
  const weekAgo = now - 7 * DAY;
  const leads7 = contacts.filter((c) => c.createdAt.getTime() >= weekAgo).length;
  const completed = convos.filter((c) => c.status === "COMPLETED").length;
  const completionRate = convos.length ? Math.round((completed / convos.length) * 100) : 0;

  // leads per day, last 14 days
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * DAY);
    d.setHours(0, 0, 0, 0);
    return { t: d.getTime(), count: 0 };
  });
  for (const c of contacts) {
    const day = new Date(c.createdAt);
    day.setHours(0, 0, 0, 0);
    const bucket = days.find((x) => x.t === day.getTime());
    if (bucket) bucket.count++;
  }
  const maxDay = Math.max(1, ...days.map((d) => d.count));

  // top services / topics
  const svc = new Map<string, number>();
  for (const c of contacts) {
    const s = (c.fields as Record<string, unknown>)?.service;
    if (typeof s === "string" && s) svc.set(s, (svc.get(s) ?? 0) + 1);
  }
  const topServices = [...svc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const needsSetup = connections === 0;

  return (
    <>
      <PageHeader title={`${he.overviewHi}, ${org.name} 👋`} subtitle={he.overviewSub} />

      {needsSetup && (
        <Card className="mb-6 !bg-gradient-to-l !from-brand/5 !to-transparent">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-base font-bold text-ink">{he.setupTitle}</div>
              <p className="mt-0.5 text-sm text-slate-500">{he.setupBody}</p>
            </div>
            <LinkButton href="/dashboard/onboarding">{he.setupCta} →</LinkButton>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={he.kpiLeads} value={contacts.length} icon="👥" />
        <Stat label={he.kpiLeads7} value={leads7} icon="📈" accent="green" hint={he.leadsOverTime} />
        <Stat label={he.kpiAppointments} value={upcomingAppts} icon="📅" accent="amber" />
        <Stat label={he.kpiCompletion} value={`${completionRate}%`} icon="✅" accent="slate" hint={`${completed}/${convos.length}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Chart */}
        <Card className="lg:col-span-2">
          <div className="mb-4 text-sm font-semibold text-ink">{he.leadsOverTime}</div>
          <div className="flex h-40 items-end gap-1.5">
            {days.map((d) => (
              <div key={d.t} className="group flex flex-1 flex-col items-center justify-end gap-1">
                <div className="text-[10px] font-medium text-slate-400 opacity-0 group-hover:opacity-100">
                  {d.count || ""}
                </div>
                <div
                  className="w-full rounded-t-md bg-brand/80 transition-all group-hover:bg-brand"
                  style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 6 : 2 }}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* Top services */}
        <Card>
          <div className="mb-4 text-sm font-semibold text-ink">{he.topServices}</div>
          {topServices.length === 0 ? (
            <p className="text-sm text-slate-400">{he.noData}</p>
          ) : (
            <ul className="space-y-3">
              {topServices.map(([name, count]) => (
                <li key={name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate-700">{name}</span>
                    <span className="font-semibold text-ink">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${(count / topServices[0]![1]) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Recent leads */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-ink">{he.recentLeads}</h2>
          <Link href="/dashboard/leads" className="text-sm font-medium text-brand">{he.viewAll} →</Link>
        </div>
        {contacts.length === 0 ? (
          <EmptyState icon="👋" title={he.noLeads} />
        ) : (
          <Card className="!p-0">
            <ul className="divide-y divide-line">
              {contacts.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link href={`/dashboard/leads/${c.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-brand/10 text-sm font-bold text-brand-dark">
                        {(c.name ?? "?").slice(0, 1)}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-ink">{c.name || "—"}</div>
                        <div className="text-xs text-slate-400" dir="ltr">{c.phone}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {c.tags.slice(0, 2).map((t) => (
                        <span key={t} className="badge-gray">{t}</span>
                      ))}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
