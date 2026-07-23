import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { createBroadcastAction } from "../actions";
import { AudienceFields } from "../AudienceFields";

export const dynamic = "force-dynamic";

export default async function NewBroadcastPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { error } = await searchParams;

  const tagRows = await prisma.contact.findMany({
    where: { organizationId: session.org },
    select: { tags: true },
  });
  const tags = [...new Set(tagRows.flatMap((r) => r.tags))].sort();

  return (
    <>
      <PageHeader title={he.newBroadcast} subtitle={he.broadcastsSubtitle} />

      {error === "empty" && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {he.broadcastNoRecipients}
        </div>
      )}

      <Card>
        <form action={createBroadcastAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">
              {he.broadcastName}
            </label>
            <input id="name" name="name" required className="input w-full" />
          </div>

          <div>
            <label className="label" htmlFor="message">
              {he.broadcastMessage}
            </label>
            <textarea id="message" name="message" rows={4} required className="input w-full" />
            <p className="mt-1 text-xs text-slate-400">{he.broadcastMessageHint}</p>
          </div>

          <div>
            <span className="label">{he.broadcastWhen}</span>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="when"
                  value="now"
                  defaultChecked
                  className="h-4 w-4 accent-brand"
                />
                {he.broadcastNow}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="radio" name="when" value="at" className="h-4 w-4 accent-brand" />
                {he.broadcastAt}
              </label>
              <input
                type="datetime-local"
                name="scheduledAt"
                className="input max-w-[14rem]"
                aria-label={he.broadcastAt}
              />
            </div>
          </div>

          <AudienceFields tags={tags} />

          <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            ⚠️ {he.broadcastSafetyNote}
          </p>

          <button className="btn-primary" type="submit">
            📢 {he.broadcastCreate}
          </button>
        </form>
      </Card>
    </>
  );
}
