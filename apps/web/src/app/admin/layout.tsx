import Link from "next/link";
import { redirect } from "next/navigation";
import { he } from "@/lib/he";
import { destroySession, getSession } from "@/lib/session";

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.sa) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-600 text-white shadow-lg">🛡️</span>
            <span className="font-black text-ink"><span className="gradient-text">{he.appName}</span> · {he.adminPanel}</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-slate-500 hover:text-ink">{he.backToApp}</Link>
            <form action={logout}>
              <button className="text-slate-500 hover:text-ink">{he.logout}</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-5 sm:p-8">{children}</main>
    </div>
  );
}
