import { hashToken } from "@kesher/core";
import { prisma } from "@kesher/db";
import { he } from "@/lib/he";
import { AcceptForm } from "./AcceptForm";

export const dynamic = "force-dynamic";

/**
 * Public invite landing page.
 *
 * The token in the URL is looked up by hash — the raw value is never stored, so
 * this is the only way to resolve it. Invalid, expired and already-accepted
 * invites all render the same page shape, revealing nothing about which case it
 * was beyond the message itself.
 */
export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } } },
  });

  const expired = invite ? invite.expiresAt.getTime() < Date.now() : false;
  const usable = invite && !invite.acceptedAt && !expired;

  return (
    <div className="mx-auto w-full max-w-md p-6">
      <div className="card-p">
        <h1 className="text-xl font-bold text-ink">{he.acceptInviteTitle}</h1>

        {!usable ? (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {expired ? he.inviteExpired : he.inviteInvalid}
          </p>
        ) : (
          <>
            <p className="mb-5 mt-1 text-sm text-slate-500">
              {invite.organization.name} · {he.roleLabel[invite.role]} — {he.acceptInviteSubtitle}
            </p>
            <AcceptForm token={token} email={invite.email} />
          </>
        )}
      </div>
    </div>
  );
}
