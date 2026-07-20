import Link from "next/link";
import { redirect } from "next/navigation";
import { type Role } from "@kesher/core";
import { prisma, type LeadStatus } from "@kesher/db";
import { BotStatus, getBotReadiness } from "@/components/BotStatus";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { buildLeadWhere, LEAD_STATUSES, STALE_DAYS, statusTone } from "@/lib/leads";

export const dynamic = "force-dynamic";

const DAY = 86400000;

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Agents get an overview of their own book, not the whole organization's.
  const viewer = { userId: session.sub, role: session.role as Role };
  const visibleLeads = buildLeadWhere(session.org, {}, viewer);

  const [org, contacts, upcomingAppts, convos, connections, members, flows] = await Promise.all([
    prisma.organization.findUnique({ where: { id: session.org } }),
    prisma.contact.findMany({ where: visibleLeads, orderBy: { createdAt: "desc" } }),
    prisma.appointment.count({
      where: { organizationId: session.org, startsAt: { gte: new Date() }, status: { in: ["BOOKED", "CONFIRMED"] } },
    }),
    prisma.conversation.findMany({ where: { organizationId: session.org }, select: { status: true } }),
    prisma.whatsAppConnection.count({ where: { organizationId: session.org, status: "CONNECTED" } }),
    prisma.user.findMany({
      where: { organizationId: session.org },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.flow.findMany({
      where: { organizationId: session.org },
      select: { id: true, name: true },
    }),
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

  // ---- pipeline analytics ----
  const byStatus = new Map<LeadStatus, number>(LEAD_STATUSES.map((s) => [s, 0]));
  for (const c of contacts) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
  const funnelMax = Math.max(1, ...byStatus.values());

  const flowName = new Map(flows.map((f) => [f.id, f.name]));
  const perScenario = new Map<string, { name: string; total: number; won: number; lost: number }>();
  for (const c of contacts) {
    const key = c.sourceFlowId ?? "__none";
    const name = c.sourceFlowId ? (flowName.get(c.sourceFlowId) ?? c.source ?? "—") : he.sourceNone;
    const row = perScenario.get(key) ?? { name, total: 0, won: 0, lost: 0 };
    row.total += 1;
    if (c.status === "WON") row.won += 1;
    if (c.status === "LOST") row.lost += 1;
    perScenario.set(key, row);
  }
  // Win rate over *decided* leads only — counting leads still in play as losses
  // would make every active scenario look like it is failing.
  const scenarioRows = [...perScenario.values()]
    .map((r) => ({ ...r, decided: r.won + r.lost }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const perAgent = members.map((m) => {
    const own = contacts.filter((c) => c.ownerUserId === m.id);
    return {
      id: m.id,
      name: m.name || m.email,
      open: own.filter((c) => c.status !== "WON" && c.status !== "LOST").length,
      won: own.filter((c) => c.status === "WON").length,
      total: own.length,
    };
  });
  const unassignedCount = contacts.filter((c) => !c.ownerUserId).length;

  const staleCutoff = now - STALE_DAYS * DAY;
  const staleLeads = contacts.filter(
    (c) =>
      c.status !== "WON" &&
      c.status !== "LOST" &&
      (c.lastContactedAt ? c.lastContactedAt.getTime() : c.createdAt.getTime()) < staleCutoff,
  );

  const readiness = await getBotReadiness(session.org);

  return (
    <>
      <PageHeader title={`${he.overviewHi}, ${org.name} 👋`} subtitle={he.overviewSub} />

      <BotStatus r={readiness} />

      {connections === 0 && (
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

      {/* Stale leads — the one thing here that is a call to action. */}
      {staleLeads.length > 0 && (
        <Card className="mt-6 !bg-amber-50/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-base font-bold text-amber-900">
                ⏳ {he.staleTitle}: {staleLeads.length}
              </div>
              <p className="mt-0.5 text-sm text-amber-800">{he.staleHint}</p>
            </div>
            <Link href="/dashboard/leads?stale=1" className="btn-secondary btn-sm">
              {he.staleView}
            </Link>
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Pipeline funnel */}
        <Card>
          <div className="text-sm font-semibold text-ink">{he.funnelTitle}</div>
          <p className="mb-4 mt-0.5 text-xs text-slate-400">{he.funnelHint}</p>
          {contacts.length === 0 ? (
            <p className="text-sm text-slate-400">{he.analyticsNoData}</p>
          ) : (
            <div className="space-y-2">
              {LEAD_STATUSES.map((s) => {
                const n = byStatus.get(s) ?? 0;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs text-slate-500">{he.leadStatus[s]}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-lg bg-slate-100">
                      <div
                        className="h-full rounded-lg bg-brand/70"
                        // Width is proportional to the biggest stage, not the
                        // total, so small stages stay visible.
                        style={{ width: `${Math.round((n / funnelMax) * 100)}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-left text-sm font-semibold text-ink">{n}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Per-agent load */}
        <Card>
          <div className="mb-4 text-sm font-semibold text-ink">{he.byAgentTitle}</div>
          {perAgent.length === 0 ? (
            <p className="text-sm text-slate-400">{he.analyticsNoData}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b border-line text-xs text-slate-400">
                  <tr>
                    <th className="p-2 font-medium">{he.colOwner}</th>
                    <th className="p-2 font-medium">{he.colOpen}</th>
                    <th className="p-2 font-medium">{he.colWon}</th>
                    <th className="p-2 font-medium">{he.colLeads}</th>
                  </tr>
                </thead>
                <tbody>
                  {perAgent.map((a) => (
                    <tr key={a.id} className="border-b border-line/60 last:border-0">
                      <td className="p-2 text-ink">{a.name}</td>
                      <td className="p-2 text-slate-600">{a.open}</td>
                      <td className="p-2 text-emerald-600">{a.won}</td>
                      <td className="p-2 text-slate-400">{a.total}</td>
                    </tr>
                  ))}
                  {unassignedCount > 0 && (
                    <tr>
                      <td className="p-2 text-slate-400">{he.unassigned}</td>
                      <td className="p-2 text-slate-600">{unassignedCount}</td>
                      <td className="p-2" />
                      <td className="p-2 text-slate-400">{unassignedCount}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Per-scenario performance */}
      <Card className="mt-6">
        <div className="mb-4 text-sm font-semibold text-ink">{he.byScenarioTitle}</div>
        {scenarioRows.length === 0 ? (
          <p className="text-sm text-slate-400">{he.analyticsNoData}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-line text-xs text-slate-400">
                <tr>
                  <th className="p-2 font-medium">{he.filterScenario}</th>
                  <th className="p-2 font-medium">{he.colLeads}</th>
                  <th className="p-2 font-medium">{he.colWon}</th>
                  <th className="p-2 font-medium">{he.colWinRate}</th>
                </tr>
              </thead>
              <tbody>
                {scenarioRows.map((r) => (
                  <tr key={r.name} className="border-b border-line/60 last:border-0">
                    <td className="p-2 text-ink">{r.name}</td>
                    <td className="p-2 text-slate-600">{r.total}</td>
                    <td className="p-2 text-emerald-600">{r.won}</td>
                    <td className="p-2">
                      {r.decided === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <Badge tone={r.won / r.decided >= 0.5 ? "green" : "gray"}>
                          {Math.round((r.won / r.decided) * 100)}%
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
