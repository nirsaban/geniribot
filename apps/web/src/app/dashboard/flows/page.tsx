import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function stepCount(def: unknown): number {
  if (def && typeof def === "object" && "nodes" in def) {
    const nodes = (def as { nodes?: Record<string, unknown> }).nodes;
    return nodes ? Object.keys(nodes).length : 0;
  }
  return 0;
}

export default async function FlowsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const flows = await prisma.flow.findMany({
    where: { organizationId: session.org },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href="/dashboard" className="text-sm text-brand">
        {he.backToDashboard}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-brand-dark">{he.flowsTitle}</h1>
      <p className="mb-6 text-sm text-gray-500">{he.flowsSubtitle}</p>

      {flows.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
          {he.noFlows}
        </p>
      ) : (
        <ul className="space-y-3">
          {flows.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-2xl bg-white p-5 shadow-sm">
              <div>
                <div className="font-semibold">{f.name}</div>
                <div className="text-sm text-gray-500">
                  {he.colVersion} {f.version} · {stepCount(f.definition)} {he.colSteps}
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  f.isActive ? "bg-brand/10 text-brand-dark" : "bg-gray-100 text-gray-500"
                }`}
              >
                {f.isActive ? he.active : he.inactive}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
