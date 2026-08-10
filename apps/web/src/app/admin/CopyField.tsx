"use client";

import { useState } from "react";
import { he } from "@/lib/he";

/** A read-only value with a copy button — for URLs that get pasted elsewhere. */
export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="mt-0.5 flex gap-2">
        <input readOnly value={value} dir="ltr" className="input w-full bg-slate-50 text-left" />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="btn-secondary shrink-0"
        >
          {copied ? he.copied : he.copyLink}
        </button>
      </div>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
