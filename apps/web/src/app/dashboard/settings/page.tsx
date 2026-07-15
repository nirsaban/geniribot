import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card, PageHeader } from "@/components/ui";
import { withBase } from "@/lib/basePath";
import { googleConfigured } from "@/lib/google";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { saveCalcomLinkAction } from "../onboarding/actions";
import { disconnectGoogleAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { google } = await searchParams;

  const integration = await prisma.calendarIntegration.findFirst({
    where: { organizationId: session.org, userId: session.sub, provider: "google" },
  });
  const org = await prisma.organization.findUnique({
    where: { id: session.org },
    select: { calcomLink: true },
  });
  const configured = googleConfigured();

  return (
    <>
      <PageHeader title={he.settingsTitle} />

      {google === "connected" && (
        <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{he.googleConnectedMsg}</div>
      )}
      {google === "error" && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{he.googleErrorMsg}</div>
      )}

      <div className="space-y-4">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-ink">📆 {he.googleCalendar}</h2>
              <p className="mt-1 text-sm text-slate-500">{he.googleCalendarDesc}</p>
            </div>
            <div className="shrink-0">
              {!configured ? (
                <span className="badge-amber">{he.googleNotConfigured}</span>
              ) : integration ? (
                <form action={disconnectGoogleAction}>
                  <button className="btn-danger btn-sm">{he.disconnectGoogle}</button>
                </form>
              ) : (
                <a href={withBase("/api/integrations/google/start")} className="btn-primary btn-sm">
                  {he.connectGoogle}
                </a>
              )}
            </div>
          </div>
          {configured && integration && (
            <div className="mt-3 badge-green">{he.googleConnected}</div>
          )}
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-ink">🔗 {he.wizCalCalcom}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-500">{he.wizCalCalcomDesc}</p>
          <form action={saveCalcomLinkAction} className="flex gap-2">
            <input name="calcom" defaultValue={org?.calcomLink ?? ""} dir="ltr" placeholder={he.calcomLinkPlaceholder} className="input text-left" />
            <button className="btn-primary shrink-0">{he.saveSecret}</button>
          </form>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-ink">🔔 {he.remindersTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{he.remindersDesc}</p>
        </Card>
      </div>
    </>
  );
}
