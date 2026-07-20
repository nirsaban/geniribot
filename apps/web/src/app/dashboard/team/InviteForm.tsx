"use client";

import { useActionState } from "react";
import { he } from "@/lib/he";
import { createInviteAction, type InviteResult } from "./actions";

/**
 * Invite creation.
 *
 * A client component because the invite link exists for exactly one moment —
 * only the token's hash is stored, so the raw link can never be re-read from
 * the database. `useActionState` keeps it on screen after the action returns;
 * a redirect-based flow would have to put the token in the URL, where it would
 * land in browser history and server logs.
 */
export function InviteForm({ canInviteOwner, mailReady }: { canInviteOwner: boolean; mailReady: boolean }) {
  const [state, action, pending] = useActionState<InviteResult | null, FormData>(
    createInviteAction,
    null,
  );

  return (
    <div>
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="invite-email">
            {he.inviteEmail}
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            dir="ltr"
            placeholder="agent@business.co.il"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="invite-role">
            {he.inviteRole}
          </label>
          <select id="invite-role" name="role" defaultValue="AGENT" className="input">
            <option value="AGENT">{he.roleLabel.AGENT}</option>
            <option value="ADMIN">{he.roleLabel.ADMIN}</option>
            {canInviteOwner && <option value="OWNER">{he.roleLabel.OWNER}</option>}
          </select>
        </div>
        <button className="btn-primary" type="submit" disabled={pending}>
          {he.inviteCreate}
        </button>
      </form>

      {!mailReady && <p className="mt-2 text-xs text-slate-400">{he.inviteLinkHint}</p>}

      {state?.error && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{state.error}</p>
      )}

      {state?.link && (
        <div className="mt-3 rounded-xl bg-emerald-50 p-3">
          <div className="text-sm font-medium text-emerald-800">{he.inviteLinkTitle}</div>
          <p className="mt-0.5 text-xs text-emerald-700">
            {state.emailed ? he.inviteEmailSent : he.inviteLinkHint}
          </p>
          {/* Selectable rather than a copy button: no clipboard permission
              prompt, and it still works over plain HTTP in local testing. */}
          <input
            readOnly
            dir="ltr"
            value={state.link}
            onFocus={(e) => e.currentTarget.select()}
            className="input mt-2 w-full bg-white text-xs"
          />
        </div>
      )}
    </div>
  );
}
