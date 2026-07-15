import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(d);
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, organizationId: session.org },
    include: {
      appointments: { orderBy: { startsAt: "asc" } },
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!contact) notFound();

  const fields = Object.entries((contact.fields as Record<string, unknown>) ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  const messages = contact.conversations.flatMap((c) => c.messages);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href="/dashboard/leads" className="text-sm text-brand">
        {he.backToLeads}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-brand-dark">{contact.name || contact.phone}</h1>
      <p className="mb-6 text-sm text-gray-500" dir="ltr">
        {contact.phone}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Collected fields */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">{he.collectedFields}</h2>
          {fields.length === 0 ? (
            <p className="text-sm text-gray-400">—</p>
          ) : (
            <dl className="space-y-2 text-sm">
              {fields.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="font-medium">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {contact.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1">
              {contact.tags.map((t) => (
                <span key={t} className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark">
                  {t}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Appointments */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">{he.appointmentsTitle}</h2>
          {contact.appointments.length === 0 ? (
            <p className="text-sm text-gray-400">{he.noAppointments}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {contact.appointments.map((a) => (
                <li key={a.id} className="flex justify-between">
                  <span>{fmt(a.startsAt)}</span>
                  <span className="text-gray-500">{a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Conversation transcript */}
      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">{he.transcript}</h2>
        {messages.length === 0 ? (
          <p className="text-sm text-gray-400">{he.noMessages}</p>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => {
              const inbound = m.direction === "IN";
              return (
                <div key={m.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                      inbound ? "bg-gray-100 text-gray-800" : "bg-brand text-white"
                    }`}
                  >
                    <div className="mb-0.5 text-[10px] opacity-60">
                      {inbound ? he.msgIn : he.msgOut} · {fmt(m.createdAt)}
                    </div>
                    {m.body}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
