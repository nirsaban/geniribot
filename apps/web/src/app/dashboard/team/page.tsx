import { redirect } from "next/navigation";
import { hasRole, mailConfigured, type Role } from "@kesher/core";
import { prisma } from "@kesher/db";
import { Badge, Card, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { changeRoleAction, removeMemberAction, revokeInviteAction } from "./actions";
import { InviteForm } from "./InviteForm";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["OWNER", "ADMIN", "AGENT"];

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short" }).format(d);
}

export default async function TeamPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Agents have no business seeing the roster or the invite form.
  if (!hasRole(session.role as Role, "ADMIN")) redirect("/dashboard");

  const [members, invites, leadCounts] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: session.org },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    prisma.invite.findMany({
      where: { organizationId: session.org, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.contact.groupBy({
      by: ["ownerUserId"],
      where: { organizationId: session.org, ownerUserId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const owners = members.filter((m) => m.role === "OWNER").length;
  const leadsByUser = new Map(leadCounts.map((r) => [r.ownerUserId, r._count._all]));
  const isOwner = session.role === "OWNER";

  return (
    <>
      <PageHeader title={he.teamTitle} subtitle={he.teamSubtitle} />

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold text-ink">{he.inviteTitle}</h2>
        <InviteForm canInviteOwner={isOwner} mailReady={mailConfigured()} />
      </Card>

      <Card className="mb-5 !p-0">
        <h2 className="px-5 pt-5 font-semibold text-ink">{he.teamMembers}</h2>
        <div className="mt-3 divide-y divide-line/60">
          {members.map((m) => {
            const self = m.id === session.sub;
            // The last owner must keep the role, or the org becomes unadministrable.
            const lockRole = m.role === "OWNER" && (owners <= 1 || !isOwner);
            return (
              <div
                key={m.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{m.name || m.email}</span>
                    {self && <Badge tone="brand">{he.youBadge}</Badge>}
                  </div>
                  <div className="mt-0.5 text-sm text-slate-500" dir="ltr">
                    {m.email}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {he.leadsTitle}: {leadsByUser.get(m.id) ?? 0} · {fmtDate(m.createdAt)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <form action={changeRoleAction} className="flex items-center gap-2">
                    <input type="hidden" name="userId" value={m.id} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      disabled={lockRole}
                      title={he.roleHint[m.role]}
                      className="input btn-sm max-w-[9rem] disabled:opacity-50"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r} disabled={r === "OWNER" && !isOwner}>
                          {he.roleLabel[r]}
                        </option>
                      ))}
                    </select>
                    <button className="btn-secondary btn-sm" type="submit" disabled={lockRole}>
                      {he.changeRole}
                    </button>
                  </form>

                  {!self && !(m.role === "OWNER" && owners <= 1) && (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="userId" value={m.id} />
                      <button className="btn-danger btn-sm" type="submit">
                        {he.removeMember}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="!p-0">
        <h2 className="px-5 pt-5 font-semibold text-ink">{he.invitesPending}</h2>
        {invites.length === 0 ? (
          <p className="p-5 text-sm text-slate-400">{he.noInvites}</p>
        ) : (
          <div className="mt-3 divide-y divide-line/60">
            {invites.map((inv) => {
              const expired = inv.expiresAt.getTime() < Date.now();
              return (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-ink" dir="ltr">
                      {inv.email || "—"}
                    </span>
                    <span className="mr-2 text-slate-400"> · {he.roleLabel[inv.role]}</span>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {expired ? (
                        <span className="text-red-500">{he.inviteExpired}</span>
                      ) : (
                        `${he.inviteExpiresAt} ${fmtDate(inv.expiresAt)}`
                      )}
                    </div>
                  </div>
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="id" value={inv.id} />
                    <button className="btn-ghost btn-sm" type="submit">
                      {he.inviteRevoke}
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
