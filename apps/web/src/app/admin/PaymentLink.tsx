"use client";

import { useState } from "react";
import { withBase } from "@/lib/basePath";
import { he } from "@/lib/he";

/** Generate a Grow payment link for an org+plan and show it to copy/send. */
export function PaymentLink({ orgId }: { orgId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const gen = async (plan: string) => {
    setBusy(true);
    setErr(null);
    setUrl(null);
    try {
      const res = await fetch(withBase("/api/admin/payment-link"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, plan }),
      });
      const data = await res.json();
      if (data.url) setUrl(data.url);
      else setErr(data.error ?? "error");
    } catch {
      setErr("error");
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <button disabled={busy} onClick={() => gen("STARTER")} className="btn-secondary btn-sm">
          {he.genLink} · בסיסי
        </button>
        <button disabled={busy} onClick={() => gen("PRO")} className="btn-secondary btn-sm">
          {he.genLink} · מקצועי
        </button>
      </div>
      {url && (
        <button
          onClick={() => navigator.clipboard?.writeText(url)}
          title={url}
          className="max-w-[220px] truncate text-[11px] text-brand hover:underline"
          dir="ltr"
        >
          📋 {url}
        </button>
      )}
      {err && <span className="text-[11px] text-red-500">{err === "not_configured" ? "הגדר Grow קודם" : err}</span>}
    </div>
  );
}
