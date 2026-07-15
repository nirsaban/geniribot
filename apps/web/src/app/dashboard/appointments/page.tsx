import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
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
    <li className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
      <div>
        <Link href={`/dashboard/leads/${a.contact.id}`} className="font-medium text-brand">
          {a.contact.name || a.contact.phone}
        </Link>
        <div className="text-sm text-gray-500">{fmt(a.startsAt)}</div>
      </div>
      <span className="rounded-full bg-brand/10 px-3 py-1 text-xs text-brand-dark">{a.status}</span>
    </li>
  );

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href="/dashboard" className="text-sm text-brand">
        {he.backToDashboard}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-brand-dark">{he.appointmentsTitle}</h1>
      <p className="mb-6 text-sm text-gray-500">{he.appointmentsSubtitle}</p>

      {appts.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
          {he.noAppointments}
        </p>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-600">{he.upcoming}</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-gray-400">{he.noAppointments}</p>
            ) : (
              <ul className="space-y-3">
                {upcoming.map((a) => (
                  <Row key={a.id} a={a} />
                ))}
              </ul>
            )}
          </section>
          {past.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-600">{he.past}</h2>
              <ul className="space-y-3 opacity-60">
                {past.map((a) => (
                  <Row key={a.id} a={a} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
