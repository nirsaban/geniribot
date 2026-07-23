"use client";

import { useState } from "react";
import Link from "next/link";
import { PLANS, type BillingInterval, type PlanId } from "@kesher/billing";
import { landing } from "./copy";

const ORDER: PlanId[] = ["FREE", "STARTER", "PRO"];
const c = landing.pricing;

export function Pricing() {
  const [interval, setInterval] = useState<BillingInterval>("MONTHLY");
  const annual = interval === "ANNUAL";

  return (
    <div>
      {/* Monthly / annual toggle */}
      <div className="mb-10 flex items-center justify-center gap-3">
        <span className={!annual ? "font-semibold text-white" : "text-slate-400"}>{c.monthly}</span>
        <button
          type="button"
          onClick={() => setInterval(annual ? "MONTHLY" : "ANNUAL")}
          className="relative h-7 w-14 rounded-full bg-slate-700 transition-colors data-[on=true]:bg-cyan-500"
          data-on={annual}
          aria-label="toggle billing interval"
        >
          <span
            className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all"
            style={{ insetInlineStart: annual ? "0.25rem" : "2.0rem" }}
          />
        </button>
        <span className={annual ? "font-semibold text-white" : "text-slate-400"}>{c.annual}</span>
        <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs font-semibold text-cyan-300">
          {c.annualHint}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {ORDER.map((id) => {
          const plan = PLANS[id];
          const featured = id === "STARTER";
          const isFree = id === "FREE";
          const price = isFree ? 0 : annual ? plan.annualIls : plan.priceIls;
          const href = `/register?plan=${id}&interval=${interval}`;

          return (
            <div
              key={id}
              className={[
                "relative flex flex-col rounded-3xl border p-7 backdrop-blur-sm transition",
                featured
                  ? "border-cyan-400/50 bg-gradient-to-b from-cyan-500/10 to-slate-900/40 shadow-[0_0_60px_-15px_rgba(34,211,238,0.5)]"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20",
              ].join(" ")}
            >
              {featured && (
                <span className="absolute -top-3 right-6 rounded-full bg-cyan-400 px-3 py-1 text-xs font-bold text-slate-950">
                  {c.popular}
                </span>
              )}

              <h3 className="text-lg font-bold text-white">{plan.name}</h3>

              <div className="mt-4 flex items-end gap-1.5">
                <span className="text-4xl font-extrabold text-white">₪{price.toLocaleString("he-IL")}</span>
                {!isFree && (
                  <span className="pb-1 text-sm text-slate-400">/ {annual ? c.perYear : c.perMonth}</span>
                )}
              </div>
              <p className="mt-1 h-5 text-xs text-slate-500">
                {isFree ? c.freeForever : annual ? c.billedAnnually : 'כולל מע"מ'}
              </p>

              <ul className="mt-6 flex-1 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <CheckIcon />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={href}
                className={[
                  "mt-7 inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition",
                  featured
                    ? "bg-cyan-400 text-slate-950 hover:bg-cyan-300 shadow-[0_0_28px_-8px_rgba(34,211,238,0.8)]"
                    : "border border-white/15 text-white hover:bg-white/10",
                ].join(" ")}
              >
                {isFree ? c.ctaFree : c.ctaPaid}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-none text-cyan-400" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.29 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
