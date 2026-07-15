import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { withBase } from "@/lib/basePath";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import {
  createCloudConnectionAction,
  createConnectionAction,
  logoutConnectionAction,
  reconnectAction,
} from "./actions";
import { QrPoller } from "./QrPoller";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const connections = await prisma.whatsAppConnection.findMany({
    where: { organizationId: session.org },
    orderBy: { createdAt: "desc" },
  });

  const origin = process.env.PUBLIC_BASE_URL ?? "https://wabot.miltech.cloud";
  const webhookUrl = `${origin}${withBase("/api/webhooks/whatsapp")}`;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href="/dashboard" className="text-sm text-brand">
        {he.backToDashboard}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-brand-dark">{he.connectionsTitle}</h1>
      <p className="mb-6 text-sm text-gray-500">{he.connectionsSubtitle}</p>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        {/* Baileys (QR) */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold">{he.providerBaileys}</h2>
          <form action={createConnectionAction} className="mt-3 flex gap-2">
            <input
              name="label"
              placeholder={he.connectionLabel}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
              {he.create}
            </button>
          </form>
        </div>

        {/* Cloud API (official) */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold">{he.providerCloud}</h2>
          <p className="mb-3 mt-1 text-xs text-gray-500">{he.cloudDesc}</p>
          <form action={createCloudConnectionAction} className="space-y-2">
            <input name="label" placeholder={he.connectionLabel} className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand" />
            <input name="phone_number_id" placeholder={he.cloudPhoneId} dir="ltr" className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-left text-sm outline-none focus:border-brand" />
            <input name="access_token" type="password" placeholder={he.cloudToken} dir="ltr" autoComplete="off" className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-left text-sm outline-none focus:border-brand" />
            <input name="verify_token" placeholder={he.cloudVerify} dir="ltr" className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-left text-sm outline-none focus:border-brand" />
            <button className="w-full rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand">
              {he.cloudCreate}
            </button>
          </form>
          <div className="mt-3 rounded-lg bg-gray-50 p-2 text-[11px]">
            <div className="font-medium text-gray-600">{he.cloudWebhookTitle}</div>
            <code dir="ltr" className="block break-all text-gray-500">{webhookUrl}</code>
          </div>
        </div>
      </div>

      {connections.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
          {he.noConnections}
        </p>
      ) : (
        <ul className="space-y-4">
          {connections.map((c) => {
            const label = he.statusLabel[c.status];
            const isCloud = c.provider === "cloud_api";
            const pairing =
              !isCloud && (c.status === "PENDING" || c.status === "QR" || c.status === "DISCONNECTED");
            const verifyToken = (c.authState as { verifyToken?: string } | null)?.verifyToken;
            return (
              <li key={c.id} className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">
                      {c.label}
                      {isCloud && (
                        <span className="mr-2 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand-dark">
                          {he.cloudViaLabel}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {label}
                      {c.phoneNumber ? ` · ${c.phoneNumber}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!isCloud && (c.status === "DISCONNECTED" || c.status === "LOGGED_OUT") && (
                      <form action={reconnectAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">
                          {he.reconnect}
                        </button>
                      </form>
                    )}
                    {c.status !== "LOGGED_OUT" && (
                      <form action={logoutConnectionAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
                          {he.disconnect}
                        </button>
                      </form>
                    )}
                  </div>
                </div>

                {pairing && (
                  <div className="mt-4 flex justify-center border-t border-gray-100 pt-4">
                    <QrPoller id={c.id} />
                  </div>
                )}
                {isCloud && verifyToken && (
                  <div className="mt-3 rounded-lg bg-gray-50 p-2 text-[11px]">
                    <div className="text-gray-500">{he.cloudWebhookHint}</div>
                    <div dir="ltr" className="mt-1 text-gray-600">Verify Token: <code>{verifyToken}</code></div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
