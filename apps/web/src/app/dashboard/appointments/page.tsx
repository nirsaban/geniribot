import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  }).format(d);
}

export default async function AppointmentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const appts = await prisma.appointment.findMany({
    where: { organizationId: session.org },
    orderBy: { startsAt: "asc" },
    include: { contact: { select: { id: true, name: true, phone: true } } },
  });

  const now = Date.now();
  const upcoming = appts.filter((a) => a.startsAt.getTime() >= now);
  const past = appts.filter((a) => a.startsAt.getTime() < now);

  const Row = ({ a }: { a: (typeof appts)[number] }) => (
    <div className="flex items-center justify-between px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-sm">📅</span>
        <div>
          <Link href={`/dashboard/leads/${a.contact.id}`} className="font-medium text-ink">
            {a.contact.name || a.contact.phone}
          </Link>
          <div className="text-xs text-slate-400">{fmt(a.startsAt)}</div>
        </div>
      </div>
      <span className="badge-brand">{a.status}</span>
    </div>
  );

  return (
    <>
      <PageHeader title={he.appointmentsTitle} subtitle={he.appointmentsSubtitle} />

      {appts.length === 0 ? (
        <EmptyState icon="📅" title={he.noAppointments} />
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">{he.upcoming}</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-400">{he.noAppointments}</p>
            ) : (
              <Card className="!p-0"><div className="divide-y divide-line">{upcoming.map((a) => <Row key={a.id} a={a} />)}</div></Card>
            )}
          </div>
          {past.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-500">{he.past}</h2>
              <Card className="!p-0 opacity-60"><div className="divide-y divide-line">{past.map((a) => <Row key={a.id} a={a} />)}</div></Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
