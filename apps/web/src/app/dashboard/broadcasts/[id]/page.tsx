import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Badge, Card, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { cancelBroadcastAction } from "../actions";

export const dynamic = "force-dynamic";

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(d);
}

export default async function BroadcastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const b = await prisma.broadcast.findFirst({
    where: { id, organizationId: session.org },
    include: { recipients: { orderBy: { phone: "asc" } } },
  });
  if (!b) notFound();

  const tone =
    b.status === "SENT"
      ? "badge-green"
      : b.status === "CANCELLED"
        ? "badge-red"
        : b.status === "SENDING"
          ? "badge-brand"
          : "badge-amber";

  return (
    <>
      <PageHeader
        title={b.name}
        subtitle={`${he.broadcastRecipients}: ${b.sentCount}/${b.totalCount}${b.scheduledAt ? ` · ⏰ ${fmt(b.scheduledAt)}` : ""}`}
        action={
          (b.status === "SCHEDULED" || b.status === "SENDING") ? (
            <form action={cancelBroadcastAction}>
              <input type="hidden" name="id" value={b.id} />
              <button className="btn-danger btn-sm">{he.broadcastCancel}</button>
            </form>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <span className={tone}>
              {he.broadcastStatus[b.status as keyof typeof he.broadcastStatus]}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-700" dir="auto">
            {b.message}
          </p>
        </Card>

        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-line text-xs text-slate-400">
                <tr>
                  <th className="p-3 font-medium">{he.colPhone}</th>
                  <th className="p-3 font-medium">{he.colName}</th>
                  <th className="p-3 font-medium">{he.colStatus}</th>
                  <th className="p-3 font-medium">{he.colCreated}</th>
                </tr>
              </thead>
              <tbody>
                {b.recipients.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3" dir="ltr">
                      {r.contactId ? (
                        <Link href={`/dashboard/leads/${r.contactId}`} className="text-brand-dark">
                          {r.phone}
                        </Link>
                      ) : (
                        r.phone
                      )}
                    </td>
                    <td className="p-3 text-slate-500">{r.name ?? "—"}</td>
                    <td className="p-3">
                      <Badge
                        tone={r.status === "SENT" ? "green" : r.status === "FAILED" ? "red" : "gray"}
                      >
                        {he.recipientStatus[r.status as keyof typeof he.recipientStatus]}
                      </Badge>
                    </td>
                    <td className="p-3 text-slate-400">{fmt(r.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
