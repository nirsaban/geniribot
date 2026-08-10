"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { withBase } from "@/lib/basePath";
import { he } from "@/lib/he";

interface Claim {
  claimed: boolean;
  plan?: string | null;
  months?: number;
  until?: string | null;
}

/** Poll for ~30s: 10 tries, 3s apart. Long enough for a slow callback, short
 *  enough that a payer who really has no matching payment isn't left waiting. */
const TRIES = 10;
const EVERY_MS = 3000;

/**
 * Waits for the payment to show up, then says what it bought.
 *
 * Grow returns the payer's browser here as soon as the card clears, which
 * regularly beats its own server-to-server callback — so the payment may
 * simply not exist on our side yet. Rather than telling someone who just paid
 * that we can't find their money, we retry quietly for half a minute and only
 * then offer the manual match by the phone/email they paid with.
 */
export function ClaimWatcher({ initial }: { initial: Claim }) {
  const [claim, setClaim] = useState<Claim>(initial);
  const [searching, setSearching] = useState(!initial.claimed);
  const [identifier, setIdentifier] = useState("");
  const [manualFailed, setManualFailed] = useState(false);
  const tries = useRef(0);

  const attempt = useCallback(async (value?: string): Promise<boolean> => {
    try {
      const res = await fetch(withBase("/api/billing/claim"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value ? { identifier: value } : {}),
      });
      const data = (await res.json()) as Claim;
      if (data.claimed) {
        setClaim(data);
        setSearching(false);
        return true;
      }
    } catch {
      // Network hiccup — the next tick retries.
    }
    return false;
  }, []);

  useEffect(() => {
    if (claim.claimed) return;
    let live = true;
    const tick = async () => {
      if (!live || tries.current >= TRIES) {
        setSearching(false);
        return;
      }
      tries.current += 1;
      if (!(await attempt())) setTimeout(tick, EVERY_MS);
    };
    const t = setTimeout(tick, EVERY_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [claim.claimed, attempt]);

  if (claim.claimed) {
    const until = claim.until
      ? new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(claim.until))
      : null;
    return (
      <>
        <p className="text-sm leading-relaxed text-slate-600">{he.thankYouClaimedBody}</p>
        {claim.plan && (
          <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
            <div className="font-semibold">{he.thankYouPlanOpened(claim.plan)}</div>
            {until && <div className="mt-0.5 text-emerald-700">{he.thankYouUntil(until, claim.months ?? 1)}</div>}
          </div>
        )}
        <Link href="/dashboard" className="btn-primary mt-6 block w-full py-2.5">
          {he.thankYouStartSetup}
        </Link>
        <Link href="/dashboard/billing" className="mt-3 block text-sm text-slate-500 hover:underline">
          {he.thankYouGoToBilling}
        </Link>
      </>
    );
  }

  if (searching) {
    return (
      <>
        <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
          <Spinner />
          {he.thankYouSearching}
        </div>
        <p className="mt-3 text-xs text-slate-400">{he.thankYouSearchingHint}</p>
      </>
    );
  }

  return (
    <>
      <p className="text-sm leading-relaxed text-slate-600">{he.thankYouNotFoundBody}</p>
      <form
        className="mt-4 space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setManualFailed(false);
          setSearching(true);
          const ok = await attempt(identifier.trim());
          setSearching(false);
          if (!ok) setManualFailed(true);
        }}
      >
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder={he.claimPaymentLabel}
          dir="ltr"
          className="input w-full text-left"
        />
        <button className="btn-primary w-full py-2.5" disabled={!identifier.trim()}>
          {he.thankYouTryMatch}
        </button>
      </form>
      {manualFailed && <p className="mt-2 text-xs text-red-500">{he.thankYouNoMatch}</p>}
      <Link href="/dashboard/billing" className="mt-3 block text-sm text-slate-500 hover:underline">
        {he.thankYouGoToBilling}
      </Link>
    </>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-brand" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
