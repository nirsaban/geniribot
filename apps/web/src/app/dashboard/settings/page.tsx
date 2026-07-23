import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card, PageHeader } from "@/components/ui";
import { withBase } from "@/lib/basePath";
import { googleConfigured } from "@/lib/google";
import { he } from "@/lib/he";
import { requireFeature } from "@/lib/plan";
import { secretMask } from "@/lib/secrets";
import { getSession } from "@/lib/session";
import { saveCalcomLinkAction } from "../onboarding/actions";
import {
  disconnectGoogleAction,
  saveCalcomWebhookSecretAction,
  saveFollowUpAction,
} from "./actions";

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
    select: {
      calcomLink: true,
      followUpEnabled: true,
      followUpAfterHours: true,
      followUpMax: true,
      followUpMessage: true,
    },
  });
  const configured = googleConfigured();
  const [calendarEntitled, followupsEntitled] = await Promise.all([
    requireFeature(session.org, "calendarSync"),
    requireFeature(session.org, "followups"),
  ]);

  const calcomSecretMask = await secretMask(session.org, "calcom_webhook_secret");
  // The public webhook URL for this tenant — built from the request's own host
  // so it is correct on any deployment without extra config.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const calcomWebhookUrl = `${proto}://${host}${withBase(`/api/webhooks/calcom/${session.org}`)}`;

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
          {/* Stacks below sm: the "not configured" badge is a full sentence, and
              `shrink-0` on one row pins the card to its max-content width. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 font-semibold text-ink">📆 {he.googleCalendar}</h2>
              <p className="mt-1 text-sm text-slate-500">{he.googleCalendarDesc}</p>
            </div>
            <div className="sm:shrink-0">
              {!calendarEntitled ? (
                <a href={withBase("/dashboard/billing")} className="btn-secondary btn-sm">
                  🔒 {he.featureLockedCta}
                </a>
              ) : !configured ? (
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
          {!calendarEntitled && (
            <p className="mt-3 text-xs text-amber-700">{he.featureLockedCalendar}</p>
          )}
          {calendarEntitled && configured && integration && (
            <div className="mt-3 badge-green">{he.googleConnected}</div>
          )}
          {calendarEntitled && configured && <p className="mt-3 text-xs text-slate-400">{he.googlePerUserHint}</p>}
          {calendarEntitled && !configured && (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              {he.googleSetupHint}
              <code dir="ltr" className="mt-2 block select-all break-all rounded-lg bg-white/70 p-2 text-left">
                https://wabot.miltech.cloud/api/integrations/google/callback
              </code>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-ink">🔗 {he.wizCalCalcom}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-500">{he.wizCalCalcomDesc}</p>
          <form action={saveCalcomLinkAction} className="flex flex-wrap gap-2">
            <input name="calcom" defaultValue={org?.calcomLink ?? ""} dir="ltr" placeholder={he.calcomLinkPlaceholder} className="input min-w-0 flex-1 text-left" />
            <button className="btn-primary shrink-0">{he.saveSecret}</button>
          </form>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-ink">📅 {he.calcomWebhookTitle}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-500">{he.calcomWebhookDesc}</p>
          <div className="mb-3">
            <label className="label">{he.calcomWebhookUrlLabel}</label>
            <code dir="ltr" className="block select-all break-all rounded-lg bg-slate-100 p-2 text-left text-xs text-slate-700">
              {calcomWebhookUrl}
            </code>
            <p className="mt-1 text-xs text-slate-400">{he.calcomWebhookEvents}</p>
          </div>
          <form action={saveCalcomWebhookSecretAction} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor="calcom-secret">
                {he.calcomWebhookSecretLabel}
              </label>
              <input
                id="calcom-secret"
                name="secret"
                dir="ltr"
                placeholder={calcomSecretMask ?? he.calcomWebhookSecretPlaceholder}
                className="input w-full text-left"
              />
            </div>
            <button className="btn-primary shrink-0">{he.saveSecret}</button>
          </form>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-ink">🔥 {he.followUpsTitle}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-500">{he.followUpsDesc}</p>
          {!followupsEntitled ? (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              {he.featureLockedFollowups}{" "}
              <a href={withBase("/dashboard/billing")} className="font-semibold underline">
                {he.featureLockedCta}
              </a>
            </div>
          ) : (
          <form action={saveFollowUpAction} className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="enabled"
                value="1"
                defaultChecked={org?.followUpEnabled ?? false}
                className="h-4 w-4 rounded border-line accent-brand"
              />
              {he.followUpEnabledLabel}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="fu-hours">
                  {he.followUpAfterHoursLabel}
                </label>
                <input
                  id="fu-hours"
                  name="afterHours"
                  type="number"
                  min={1}
                  max={336}
                  defaultValue={org?.followUpAfterHours ?? 48}
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="fu-max">
                  {he.followUpMaxLabel}
                </label>
                <input
                  id="fu-max"
                  name="max"
                  type="number"
                  min={1}
                  max={5}
                  defaultValue={org?.followUpMax ?? 2}
                  className="input"
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fu-message">
                {he.followUpMessageLabel}
              </label>
              <textarea
                id="fu-message"
                name="message"
                rows={2}
                defaultValue={org?.followUpMessage ?? ""}
                placeholder={he.followUpDefaultMessage}
                className="input w-full"
              />
              <p className="mt-1 text-xs text-slate-400">{he.followUpMessageHint}</p>
            </div>
            <button className="btn-primary">{he.saveSecret}</button>
          </form>
          )}
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-ink">🔔 {he.remindersTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{he.remindersDesc}</p>
        </Card>
      </div>
    </>
  );
}
