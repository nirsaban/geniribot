import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { requireFeature } from "@/lib/plan";
import { getSession } from "@/lib/session";
import { createGroupAction } from "../broadcasts/actions";
import { AudienceFields } from "../broadcasts/AudienceFields";

export const dynamic = "force-dynamic";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; added?: string; failed?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;

  if (!(await requireFeature(session.org, "groups"))) {
    return (
      <>
        <PageHeader title={he.groupsTitle} subtitle={he.groupsSubtitle} />
        <EmptyState
          icon="🔒"
          title={he.featureLockedTitle}
          body={he.featureLockedBroadcasts}
          action={<LinkButton href="/dashboard/billing">{he.featureLockedCta}</LinkButton>}
        />
      </>
    );
  }

  const [conn, tagRows] = await Promise.all([
    prisma.whatsAppConnection.findFirst({
      where: {
        organizationId: session.org,
        status: "CONNECTED",
        provider: { not: "cloud_api" },
      },
      select: { id: true, label: true },
    }),
    prisma.contact.findMany({ where: { organizationId: session.org }, select: { tags: true } }),
  ]);
  const tags = [...new Set(tagRows.flatMap((r) => r.tags))].sort();

  return (
    <>
      <PageHeader title={he.groupsTitle} subtitle={he.groupsSubtitle} />

      {sp.created === "1" && (
        <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
          {he.groupCreated} — {he.groupAddedCount} {sp.added ?? "0"}
          {Number(sp.failed ?? 0) > 0 ? ` · ${he.groupFailedCount}: ${sp.failed}` : ""}
        </div>
      )}
      {sp.error === "empty" && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {he.broadcastNoRecipients}
        </div>
      )}
      {sp.error === "no_connection" && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {he.groupNeedsConnection}
        </div>
      )}
      {sp.error === "gateway" && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{he.googleErrorMsg}</div>
      )}

      {!conn ? (
        <Card>
          <p className="text-sm text-slate-600">{he.groupNeedsConnection}</p>
          <p className="mt-1 text-xs text-slate-400">{he.groupNotSupportedCloud}</p>
        </Card>
      ) : (
        <Card>
          <form action={createGroupAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="subject">
                {he.groupSubject}
              </label>
              <input id="subject" name="subject" required className="input w-full" />
            </div>

            <div>
              <label className="label" htmlFor="welcome">
                {he.groupWelcome}
              </label>
              <textarea id="welcome" name="welcome" rows={2} className="input w-full" />
            </div>

            <AudienceFields tags={tags} />

            <button className="btn-primary" type="submit">
              👥 {he.groupCreate}
            </button>
          </form>
        </Card>
      )}
    </>
  );
}
