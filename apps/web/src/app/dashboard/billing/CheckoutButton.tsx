"use client";

import { useEffect, useState } from "react";
import type { BillingInterval, PlanId } from "@kesher/billing";
import { withBase } from "@/lib/basePath";
import { he } from "@/lib/he";

const GROW_ORIGINS = new Set(["https://meshulam.co.il", "https://sandbox.meshulam.co.il"]);
const PAID_ACTIONS = new Set(["payment", "bit_payment", "apple_payment", "google_payment"]);
const DISMISS_ACTIONS = new Set(["close", "bit_cancel", "failed_to_load_page"]);

/**
 * Starts a paid-plan checkout and embeds Grow's payment page in an on-site
 * iframe instead of redirecting away. Grow posts window.postMessage events
 * from inside the iframe so we can react to success without waiting for the
 * server-side webhook round trip.
 */
export function CheckoutButton({
  plan,
  interval,
  label,
  className,
}: {
  plan: PlanId;
  interval: BillingInterval;
  label: string;
  className: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    const onMessage = (e: MessageEvent) => {
      if (!GROW_ORIGINS.has(e.origin)) return;
      const action = e.data?.action as string | undefined;
      if (action && PAID_ACTIONS.has(action) && Number(e.data?.status) === 1) {
        setPaid(true);
        setTimeout(() => {
          window.location.href = withBase("/dashboard/billing?paid=1");
        }, 1500);
      } else if (action && DISMISS_ACTIONS.has(action)) {
        setUrl(null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [url]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withBase("/api/billing/checkout"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, interval }),
      });
      const data = await res.json();
      if (data.url) setUrl(data.url);
      else setError(he.checkoutGenericError);
    } catch {
      setError(he.checkoutGenericError);
    }
    setBusy(false);
  };

  return (
    <>
      <button onClick={start} disabled={busy} className={className}>
        {label}
      </button>
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
      {url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
            {!paid && (
              <button
                onClick={() => setUrl(null)}
                aria-label="close"
                className="absolute left-2 top-2 z-10 rounded-full bg-white/90 px-2.5 py-1 text-sm text-slate-500 shadow hover:bg-white"
              >
                ✕
              </button>
            )}
            {paid ? (
              <div className="p-10 text-center text-emerald-700">{he.chargeSuccess}</div>
            ) : (
              <iframe src={url} className="h-[640px] w-full border-0" title="Grow checkout" />
            )}
          </div>
        </div>
      )}
    </>
  );
}
