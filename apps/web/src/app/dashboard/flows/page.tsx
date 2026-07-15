import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { createFlowAction, toggleFlowActiveAction } from "./actions";

export const dynamic = "force-dynamic";

function stepCount(def: unknown): number {
  if (def && typeof def === "object" && "nodes" in def) {
    const nodes = (def as { nodes?: Record<string, unknown> }).nodes;
    return nodes ? Object.keys(nodes).length : 0;
  }
  return 0;
}

function triggerLabel(def: unknown): string {
  const t = (def as { trigger?: { type?: string; keywords?: string[] } } | null)?.trigger;
  if (t?.type === "keyword" && t.keywords?.length) return `מילות מפתח: ${t.keywords.join(", ")}`;
  return "כל הודעה ראשונה";
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
      <div className="mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">{he.flowsTitle}</h1>
          <p className="text-sm text-gray-500">{he.flowsSubtitle}</p>
        </div>
        <form action={createFlowAction}>
          <input type="hidden" name="template" value="lead" />
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            + {he.newFlow}
          </button>
        </form>
      </div>

      {flows.length === 0 ? (
        <p className="mt-6 rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
          {he.noFlows}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {flows.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-2xl bg-white p-5 shadow-sm">
              <div>
                <div className="font-semibold">{f.name}</div>
                <div className="text-sm text-gray-500">
                  {he.colVersion} {f.version} · {stepCount(f.definition)} {he.colSteps}
                </div>
                <div className="mt-0.5 text-xs text-amber-700">⚡ {triggerLabel(f.definition)}</div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    f.isActive ? "bg-brand/10 text-brand-dark" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {f.isActive ? he.active : he.inactive}
                </span>
                <form action={toggleFlowActiveAction}>
                  <input type="hidden" name="id" value={f.id} />
                  <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">
                    {f.isActive ? he.deactivate : he.activate}
                  </button>
                </form>
                <Link
                  href={`/dashboard/flows/${f.id}/edit`}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
                >
                  {he.editFlow}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
