"use client";

import { useActionState } from "react";
import { he } from "@/lib/he";
import { acceptInviteAction } from "@/app/dashboard/team/actions";

export function AcceptForm({ token, email }: { token: string; email: string | null }) {
  const [state, action, pending] = useActionState<{ error?: string } | null, FormData>(
    acceptInviteAction,
    null,
  );

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="label" htmlFor="name">
          {he.yourName}
        </label>
        <input id="name" name="name" className="input" autoComplete="name" />
      </div>

      <div>
        <label className="label" htmlFor="email">
          {he.email}
        </label>
        {/* A targeted invite is locked to its address — the action re-checks
            this, so a tampered field fails rather than binding the wrong user. */}
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          required
          defaultValue={email ?? ""}
          readOnly={Boolean(email)}
          autoComplete="email"
          className={`input ${email ? "bg-slate-50" : ""}`}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          {he.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className="input"
        />
      </div>

      {state?.error && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{state.error}</p>
      )}

      <button className="btn-primary mt-1" type="submit" disabled={pending}>
        {he.acceptInviteCta}
      </button>
    </form>
  );
}
