import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import {
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

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href="/dashboard" className="text-sm text-brand">
        {he.backToDashboard}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-brand-dark">{he.connectionsTitle}</h1>
      <p className="mb-6 text-sm text-gray-500">{he.connectionsSubtitle}</p>

      <form action={createConnectionAction} className="mb-8 flex gap-2">
        <input
          name="label"
          placeholder={he.connectionLabel}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-brand"
        />
        <button className="rounded-lg bg-brand px-5 py-2 font-semibold text-white hover:bg-brand-dark">
          {he.create}
        </button>
      </form>

      {connections.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
          {he.noConnections}
        </p>
      ) : (
        <ul className="space-y-4">
          {connections.map((c) => {
            const label = he.statusLabel[c.status];
            const pairing = c.status === "PENDING" || c.status === "QR" || c.status === "DISCONNECTED";
            return (
              <li key={c.id} className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{c.label}</div>
                    <div className="text-sm text-gray-500">
                      {label}
                      {c.phoneNumber ? ` · ${c.phoneNumber}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {(c.status === "DISCONNECTED" || c.status === "LOGGED_OUT") && (
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
