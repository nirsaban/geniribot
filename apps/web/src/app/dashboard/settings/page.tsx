import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { withBase } from "@/lib/basePath";
import { googleConfigured } from "@/lib/google";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
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
  const configured = googleConfigured();

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Link href="/dashboard" className="text-sm text-brand">
        {he.backToDashboard}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-brand-dark">{he.settingsTitle}</h1>

      {google === "connected" && (
        <p className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{he.googleConnectedMsg}</p>
      )}
      {google === "error" && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{he.googleErrorMsg}</p>
      )}

      {/* Google Calendar */}
      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-semibold">{he.googleCalendar}</h2>
        <p className="mt-1 text-sm text-gray-500">{he.googleCalendarDesc}</p>

        <div className="mt-4">
          {!configured ? (
            <p className="text-sm text-amber-700">{he.googleNotConfigured}</p>
          ) : integration ? (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-brand">{he.googleConnected}</span>
              <form action={disconnectGoogleAction}>
                <button className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
                  {he.disconnectGoogle}
                </button>
              </form>
            </div>
          ) : (
            <a
              href={withBase("/api/integrations/google/start")}
              className="inline-block rounded-lg bg-brand px-5 py-2 font-semibold text-white hover:bg-brand-dark"
            >
              {he.connectGoogle}
            </a>
          )}
        </div>
      </section>

      {/* Reminders */}
      <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-semibold">{he.remindersTitle}</h2>
        <p className="mt-1 text-sm text-gray-500">{he.remindersDesc}</p>
      </section>
    </div>
  );
}
