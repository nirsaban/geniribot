import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { connectionName, orgConnections } from "@/lib/connections";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { setFlowConnectionAction, setFlowProductAction } from "../../actions";
import { SequenceEditor } from "./SequenceEditor";

export const dynamic = "force-dynamic";

export default async function EditFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const [flow, members, products, connections] = await Promise.all([
    prisma.flow.findFirst({ where: { id, organizationId: session.org } }),
    // For the "assign to" step: the people a lead can be routed to.
    prisma.user.findMany({
      where: { organizationId: session.org },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.findMany({
      where: { organizationId: session.org },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
    orgConnections(session.org),
  ]);
  if (!flow) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = flow.definition as any;

  return (
    <>
      <Link href="/dashboard/flows" className="text-sm font-medium text-brand">
        {he.backToFlows}
      </Link>
      <div className="mb-5 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">
          {flow.name} <span className="text-sm font-normal text-slate-400">v{flow.version}</span>
        </h1>
        {products.length > 0 && (
          <form action={setFlowProductAction} className="flex items-center gap-2 text-sm">
            <input type="hidden" name="id" value={flow.id} />
            <span className="text-slate-500">{he.flowProductLabel}</span>
            <select name="productId" defaultValue={flow.productId ?? ""} className="input btn-sm">
              <option value="">{he.flowProductNone}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn-secondary btn-sm">{he.saveAssignment}</button>
          </form>
        )}
      </div>

      {/* Which number runs this scenario. Only shown once the org has more than
          one — with a single number there is nothing to choose between. */}
      {connections.length > 1 && (
        <div className="mb-5 rounded-xl bg-slate-50 p-3">
          <form action={setFlowConnectionAction} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="id" value={flow.id} />
            <span className="text-slate-500">📱 {he.flowConnectionLabel}</span>
            <select
              name="connectionId"
              defaultValue={flow.connectionId ?? ""}
              className="input btn-sm"
            >
              <option value="">{he.flowConnectionAll}</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {connectionName(c)}
                </option>
              ))}
            </select>
            <button className="btn-secondary btn-sm">{he.saveAssignment}</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">{he.flowConnectionHint}</p>
        </div>
      )}
      <SequenceEditor flowId={flow.id} initial={def} isActive={flow.isActive} members={members} />
    </>
  );
}
