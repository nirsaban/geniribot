"use client";

import { useState } from "react";
import Link from "next/link";
import { withBase } from "@/lib/basePath";
import { he } from "@/lib/he";
import { saveCalcomLinkAction, useInChatBookingAction } from "./actions";

interface Props {
  connected: boolean;
  googleConnected: boolean;
  googleConfigured: boolean;
  calcomLink: string | null;
  finish: () => Promise<void>;
}

type CalMode = "chat" | "google" | "calcom";

export function OnboardingWizard({ connected, googleConnected, googleConfigured, calcomLink, finish }: Props) {
  const [step, setStep] = useState(0);
  const [calMode, setCalMode] = useState<CalMode>(calcomLink ? "calcom" : googleConnected ? "google" : "chat");

  const steps = [he.wizWelcomeTitle, he.wizWhatsappTitle, he.wizAvailTitle, he.wizCalTitle, he.wizDoneTitle];
  const last = steps.length - 1;
  const go = (i: number) => setStep(Math.max(0, Math.min(last, i)));

  return (
    <div className="mx-auto max-w-lg">
      {/* Step indicators (clickable to jump) */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {steps.map((_, i) => (
          <button
            key={i}
            onClick={() => go(i)}
            className={`h-2.5 rounded-full transition-all ${
              i === step ? "w-8 bg-brand" : i < step ? "w-2.5 bg-brand/50" : "w-2.5 bg-slate-200"
            }`}
            aria-label={`${he.wizStepOf} ${i + 1}`}
          />
        ))}
      </div>

      <div className="card p-8 text-center">
        <div className="mb-1 text-xs font-medium text-slate-400">
          {he.wizStepOf} {step + 1} {he.wizOf} {steps.length}
        </div>

        {/* Step 0 — welcome */}
        {step === 0 && (
          <Stage emoji="👋" title={he.wizWelcomeTitle} body={he.wizWelcomeBody}>
            <button onClick={() => go(1)} className="btn-primary w-full">{he.wizStart}</button>
          </Stage>
        )}

        {/* Step 1 — WhatsApp */}
        {step === 1 && (
          <Stage emoji="💬" title={he.wizWhatsappTitle} body={he.wizWhatsappBody}>
            {connected ? (
              <div className="badge-green mx-auto">{he.wizWhatsappDone}</div>
            ) : (
              <Link href="/dashboard/connections" target="_blank" className="btn-primary w-full">
                {he.wizWhatsappCta} ↗
              </Link>
            )}
          </Stage>
        )}

        {/* Step 2 — availability */}
        {step === 2 && (
          <Stage emoji="🕘" title={he.wizAvailTitle} body={he.wizAvailBody} />
        )}

        {/* Step 3 — calendar mode */}
        {step === 3 && (
          <Stage emoji="📅" title={he.wizCalTitle} body={he.wizCalBody}>
            <div className="space-y-2 text-right">
              <ModeCard active={calMode === "chat"} onClick={() => { setCalMode("chat"); }} title={he.wizCalInChat} desc={he.wizCalInChatDesc} />
              <ModeCard active={calMode === "calcom"} onClick={() => setCalMode("calcom")} title={he.wizCalCalcom} desc={he.wizCalCalcomDesc} />
              {googleConfigured && (
                <ModeCard active={calMode === "google"} onClick={() => setCalMode("google")} title={he.wizCalGoogle} desc={he.wizCalGoogleDesc} />
              )}
            </div>

            {calMode === "calcom" && (
              <form action={saveCalcomLinkAction} className="mt-3 flex gap-2">
                <input name="calcom" defaultValue={calcomLink ?? ""} dir="ltr" placeholder={he.calcomLinkPlaceholder} className="input text-left" />
                <button className="btn-primary btn-sm shrink-0">💾</button>
              </form>
            )}
            {calMode === "google" && !googleConnected && (
              <a href={withBase("/api/integrations/google/start")} className="btn-secondary btn-sm mt-3">{he.connectGoogle}</a>
            )}
            {calMode === "google" && googleConnected && <div className="badge-green mx-auto mt-3">{he.googleConnected}</div>}
            {calMode === "chat" && (
              <form action={useInChatBookingAction} className="mt-3">
                <button className="text-xs text-slate-400 hover:underline">{he.wizCalInChat} ✓</button>
              </form>
            )}
          </Stage>
        )}

        {/* Step 4 — done */}
        {step === last && (
          <Stage emoji="🚀" title={he.wizDoneTitle} body={he.wizDoneBody}>
            <form action={finish}>
              <button className="btn-primary w-full py-3">{he.wizFinish}</button>
            </form>
          </Stage>
        )}

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
          <button onClick={() => go(step - 1)} disabled={step === 0} className="btn-ghost btn-sm disabled:opacity-30">
            ← {he.wizBack}
          </button>
          {step < last ? (
            <div className="flex gap-2">
              <button onClick={() => go(step + 1)} className="btn-ghost btn-sm text-slate-400">{he.wizSkip}</button>
              <button onClick={() => go(step + 1)} className="btn-primary btn-sm">{he.wizNext} →</button>
            </div>
          ) : (
            <span className="text-xs text-slate-300">✓</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Stage({ emoji, title, body, children }: { emoji: string; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="py-4">
      <div className="mb-3 text-5xl">{emoji}</div>
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{body}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

function ModeCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-right transition ${active ? "border-brand bg-brand/5" : "border-line hover:bg-slate-50"}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink">{title}</span>
        <span className={`grid h-4 w-4 place-items-center rounded-full border ${active ? "border-brand bg-brand text-white" : "border-slate-300"}`}>
          {active && <span className="text-[8px]">✓</span>}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-slate-400">{desc}</div>
    </button>
  );
}
