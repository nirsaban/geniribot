import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { cancelBroadcastAction } from "./actions";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(d);
}

function statusTone(s: string): "brand" | "gray" | "green" | "amber" | "red" {
  switch (s) {
    case "SCHEDULED":
      return "amber";
    case "SENDING":
      return "brand";
    case "SENT":
      return "green";
    case "CANCELLED":
      return "red";
    default:
      return "gray";
  }
}

export default async function BroadcastsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const broadcasts = await prisma.broadcast.findMany({
    where: { organizationId: session.org },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeader
        title={he.broadcastsTitle}
        subtitle={he.broadcastsSubtitle}
        action={
          <Link href="/dashboard/broadcasts/new" className="btn-primary">
            + {he.newBroadcast}
          </Link>
        }
      />

      {broadcasts.length === 0 ? (
        <EmptyState icon="📢" title={he.noBroadcasts} />
      ) : (
        <div className="space-y-3">
          {broadcasts.map((b) => (
            <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3 !p-4">
              <div className="min-w-0">
                <Link href={`/dashboard/broadcasts/${b.id}`} className="font-semibold text-ink">
                  {b.name}
                </Link>
                <div className="mt-0.5 truncate text-sm text-slate-400" dir="auto">
                  {b.message.slice(0, 80)}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {b.scheduledAt ? `⏰ ${fmtDate(b.scheduledAt)} · ` : ""}
                  {b.sentCount}/{b.totalCount} {he.broadcastRecipients}
                  {b.failedCount > 0 ? ` · ${b.failedCount} ${he.recipientStatus.FAILED}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(b.status)}>
                  {he.broadcastStatus[b.status as keyof typeof he.broadcastStatus]}
                </Badge>
                {(b.status === "SCHEDULED" || b.status === "SENDING") && (
                  <form action={cancelBroadcastAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <button className="btn-danger btn-sm">{he.broadcastCancel}</button>
                  </form>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
