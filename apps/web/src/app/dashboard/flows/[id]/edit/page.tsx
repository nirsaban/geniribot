import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { SequenceEditor } from "./SequenceEditor";

export const dynamic = "force-dynamic";

export default async function EditFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const flow = await prisma.flow.findFirst({
    where: { id, organizationId: session.org },
  });
  if (!flow) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = flow.definition as any;

  return (
    <>
      <Link href="/dashboard/flows" className="text-sm font-medium text-brand">
        {he.backToFlows}
      </Link>
      <h1 className="mb-5 mt-2 text-2xl font-bold text-ink">
        {flow.name} <span className="text-sm font-normal text-slate-400">v{flow.version}</span>
      </h1>
      <SequenceEditor flowId={flow.id} initial={def} />
    </>
  );
}
