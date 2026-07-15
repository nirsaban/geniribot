import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { destroySession, getSession } from "@/lib/session";

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const org = await prisma.organization.findUnique({
    where: { id: session.org },
    include: {
      _count: {
        select: { connections: true, flows: true, contacts: true, appointments: true },
      },
    },
  });
  if (!org) redirect("/login");

  const cards = [
    { label: he.connections, value: org._count.connections },
    { label: he.flows, value: org._count.flows },
    { label: he.leads, value: org._count.contacts },
    { label: he.appointments, value: org._count.appointments },
  ];

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">{he.dashboard}</h1>
          <p className="text-sm text-gray-500">
            {he.welcome}, {org.name}
          </p>
        </div>
        <form action={logout}>
          <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100">
            {he.logout}
          </button>
        </form>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="text-3xl font-bold text-brand">{c.value}</div>
            <div className="mt-1 text-sm text-gray-500">{c.label}</div>
          </div>
        ))}
      </section>

      <nav className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/dashboard/connections"
          className="inline-block rounded-lg bg-brand px-5 py-2 font-semibold text-white hover:bg-brand-dark"
        >
          {he.connections} →
        </Link>
        <Link
          href="/dashboard/leads"
          className="inline-block rounded-lg border border-gray-300 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-100"
        >
          {he.leads} →
        </Link>
        <Link
          href="/dashboard/appointments"
          className="inline-block rounded-lg border border-gray-300 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-100"
        >
          {he.appointments} →
        </Link>
        <Link
          href="/dashboard/flows"
          className="inline-block rounded-lg border border-gray-300 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-100"
        >
          {he.flows} →
        </Link>
        <Link
          href="/dashboard/settings"
          className="inline-block rounded-lg border border-gray-300 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-100"
        >
          {he.settings} →
        </Link>
        <Link
          href="/dashboard/billing"
          className="inline-block rounded-lg border border-gray-300 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-100"
        >
          {he.billing} →
        </Link>
        <Link
          href="/dashboard/onboarding"
          className="inline-block rounded-lg border border-amber-300 bg-amber-50 px-5 py-2 font-semibold text-amber-800 hover:bg-amber-100"
        >
          {he.onboarding} →
        </Link>
      </nav>

      <p className="mt-8 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{he.phase0Note}</p>
    </div>
  );
}
