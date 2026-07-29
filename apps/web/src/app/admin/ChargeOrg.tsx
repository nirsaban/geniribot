"use client";

import { useState } from "react";
import { withBase } from "@/lib/basePath";
import { he } from "@/lib/he";

/** Charge an org's saved Grow card token for an arbitrary amount — no payment link. */
export function ChargeOrg({ orgId, hasSavedCard }: { orgId: string; hasSavedCard: boolean }) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!hasSavedCard) return <span className="text-[11px] text-gray-400">{he.chargeNoSavedCard}</span>;

  const charge = async () => {
    const sumIls = Number(amount);
    if (!(sumIls > 0) || !desc.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(withBase("/api/admin/charge"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, sumIls, description: desc.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ ok: true, text: he.chargeSuccess });
        setAmount("");
        setDesc("");
      } else {
        setMsg({ ok: false, text: data.error ?? he.chargeFailed });
      }
    } catch {
      setMsg({ ok: false, text: he.chargeFailed });
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          min={1}
          placeholder={he.chargeAmountPlaceholder}
          className="w-20 rounded-lg border border-line px-2 py-1 text-[11px]"
          dir="ltr"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={he.chargeDescPlaceholder}
          className="w-28 rounded-lg border border-line px-2 py-1 text-[11px]"
        />
        <button disabled={busy} onClick={charge} className="btn-secondary btn-sm shrink-0">
          {he.chargeSavedCard}
        </button>
      </div>
      {msg && <span className={`text-[11px] ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</span>}
    </div>
  );
}
