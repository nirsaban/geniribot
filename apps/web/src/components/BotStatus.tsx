import Link from "next/link";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";

/** Is the bot actually live? Needs a CONNECTED number AND an active flow. */
export async function getBotReadiness(org: string) {
  const [connected, activeFlow] = await Promise.all([
    prisma.whatsAppConnection.findFirst({
      where: { organizationId: org, status: "CONNECTED" },
      select: { phoneNumber: true, provider: true },
    }),
    prisma.flow.count({ where: { organizationId: org, isActive: true } }),
  ]);
  return {
    connected: Boolean(connected),
    phone: connected?.phoneNumber ?? null,
    provider: connected?.provider ?? null,
    activeFlow: activeFlow > 0,
    live: Boolean(connected) && activeFlow > 0,
  };
}

type Readiness = Awaited<ReturnType<typeof getBotReadiness>>;

/** At-a-glance banner: green when live, otherwise the exact next step. */
export function BotStatus({ r }: { r: Readiness }) {
  if (r.live) {
    // Cloud connections store the phone_number_id in `phone`; only show real numbers.
    const showPhone = r.provider === "baileys" && r.phone;
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <div>
            <div className="font-bold text-emerald-800">🟢 {he.statusLive}</div>
            <div className="text-sm text-emerald-700">{he.statusLiveHint}</div>
          </div>
        </div>
        {showPhone && (
          <div className="rounded-xl bg-white px-3 py-1.5 text-sm text-emerald-800 shadow-sm">
            {he.statusTestNumber} <span dir="ltr" className="font-semibold">+{r.phone}</span>
          </div>
        )}
      </div>
    );
  }

  if (!r.connected) {
    return (
      <Banner tone="slate" icon="⚪" title={he.statusNoNumber} hint={he.statusNoNumberHint} />
    );
  }
  // connected but no active flow
  return (
    <Banner
      tone="amber"
      icon="🟡"
      title={he.statusNoFlow}
      hint={he.statusNoFlowHint}
      action={<Link href="/dashboard/flows" className="btn-primary btn-sm">{he.statusActivateFlow} →</Link>}
    />
  );
}

function Banner({
  tone,
  icon,
  title,
  hint,
  action,
}: {
  tone: "amber" | "slate";
  icon: string;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  const styles =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4 ${styles}`}>
      <div>
        <div className="font-bold">{icon} {title}</div>
        <div className="text-sm opacity-90">{hint}</div>
      </div>
      {action}
    </div>
  );
}
