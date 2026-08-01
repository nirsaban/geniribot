import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { setFlowProductAction } from "../../actions";
import { SequenceEditor } from "./SequenceEditor";

export const dynamic = "force-dynamic";

export default async function EditFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const [flow, members, products] = await Promise.all([
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
      <SequenceEditor flowId={flow.id} initial={def} isActive={flow.isActive} members={members} />
    </>
  );
}
