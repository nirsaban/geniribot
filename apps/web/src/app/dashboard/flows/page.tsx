import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { createFlowAction, toggleFlowActiveAction } from "./actions";
import { FlowCardActions } from "./FlowCardActions";

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
    <>
      <PageHeader
        title={he.flowsTitle}
        subtitle={he.flowsSubtitle}
        action={
          <form action={createFlowAction}>
            <input type="hidden" name="template" value="lead" />
            <button className="btn-primary">+ {he.newFlow}</button>
          </form>
        }
      />

      {flows.length === 0 ? (
        <EmptyState icon="🧩" title={he.noFlows} />
      ) : (
        <div className="space-y-3">
          {flows.map((f) => (
            <Card key={f.id} className="flex items-center justify-between !p-4">
              <div>
                <div className="font-semibold text-ink">{f.name}</div>
                <div className="mt-0.5 text-sm text-slate-400">
                  {he.colVersion} {f.version} · {stepCount(f.definition)} {he.colSteps}
                </div>
                <div className="mt-1 text-xs text-amber-700">⚡ {triggerLabel(f.definition)}</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className={f.isActive ? "badge-green" : "badge-gray"}>
                  {f.isActive ? he.active : he.inactive}
                </span>
                <form action={toggleFlowActiveAction}>
                  <input type="hidden" name="id" value={f.id} />
                  <button className="btn-secondary btn-sm">{f.isActive ? he.deactivate : he.activate}</button>
                </form>
                <Link href={`/dashboard/flows/${f.id}/edit`} className="btn-primary btn-sm">
                  {he.editFlow}
                </Link>
                <FlowCardActions id={f.id} name={f.name} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
