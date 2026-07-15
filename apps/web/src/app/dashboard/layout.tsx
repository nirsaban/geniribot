import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Sidebar } from "@/components/Sidebar";
import { he } from "@/lib/he";
import { destroySession, getSession } from "@/lib/session";

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const org = await prisma.organization.findUnique({
    where: { id: session.org },
    select: { name: true },
  });

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (right side in RTL) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-line bg-white md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="logo-3d grid h-10 w-10 place-items-center rounded-xl text-lg font-black text-white">G</span>
          <div>
            <div className="gradient-text text-base font-black leading-none">{he.appName}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">{org?.name}</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Sidebar orgName={org?.name ?? ""} />
        </div>
        <div className="border-t border-line p-3">
          {session.sa && (
            <Link href="/admin" className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-violet-700 hover:bg-violet-50">
              <span>🛡️</span> {he.adminPanel}
            </Link>
          )}
          <form action={logout}>
            <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100">
              <span>🚪</span> {he.logout}
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3 md:hidden">
          <span className="font-extrabold text-ink">{he.appName}</span>
          <form action={logout}>
            <button className="text-sm text-slate-500">{he.logout}</button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
