"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { he } from "@/lib/he";
import { saveFlowAction } from "../../actions";

type StepKind = "message" | "question" | "book";
interface Step {
  id: string;
  kind: StepKind;
  text?: string;
  prompt?: string;
  field?: string;
  expect?: string;
  choices?: string[];
}
interface Trigger {
  type: "any" | "keyword";
  keywords?: string[];
}
interface Def {
  start: string;
  nodes: Record<string, unknown>;
  trigger?: Trigger;
}

const EXPECTS: Record<string, string> = {
  text: "טקסט",
  number: "מספר",
  email: "אימייל",
  phone: "טלפון",
  choice: "בחירה",
  date: "תאריך",
};
const KIND: Record<StepKind, { icon: string; label: string; color: string }> = {
  message: { icon: "💬", label: he.stepMessageLabel, color: "#0d9488" },
  question: { icon: "❓", label: he.stepQuestionLabel, color: "#2563eb" },
  book: { icon: "📅", label: he.stepBookLabel, color: "#d97706" },
};

let counter = 0;
const newId = () => `n_${Date.now().toString(36)}_${counter++}`;

// ---- load: linearize an existing flow definition into steps ----
function defToSteps(def: Def): Step[] {
  const steps: Step[] = [];
  const nodes = def.nodes as Record<string, Record<string, unknown>>;
  const seen = new Set<string>();
  let cur: string | null | undefined = def.start;
  while (cur && nodes[cur] && !seen.has(cur)) {
    seen.add(cur);
    const n: Record<string, unknown> = nodes[cur]!;
    if (n.type === "message") steps.push({ id: cur, kind: "message", text: n.text as string });
    else if (n.type === "question")
      steps.push({ id: cur, kind: "question", prompt: n.prompt as string, field: n.field as string, expect: (n.expect as string) ?? "text", choices: n.choices as string[] });
    else if (n.type === "action" && n.action === "book_appointment") steps.push({ id: cur, kind: "book" });
    cur = n.type === "condition" ? ((n.then as string) ?? (n.else as string)) : (n.next as string);
  }
  return steps;
}

// ---- save: steps -> flow definition (linear chain) ----
function stepsToDef(steps: Step[], trigger: Trigger): Def {
  const nodes: Record<string, unknown> = {};
  steps.forEach((s, i) => {
    const next = steps[i + 1]?.id ?? null;
    if (s.kind === "message") nodes[s.id] = { type: "message", text: s.text ?? "", next };
    else if (s.kind === "question")
      nodes[s.id] = {
        type: "question",
        prompt: s.prompt ?? "",
        field: s.field || "field",
        expect: s.expect ?? "text",
        ...(s.choices?.length ? { choices: s.choices } : {}),
        next,
      };
    else nodes[s.id] = { type: "action", action: "book_appointment", next };
  });
  return { start: steps[0]?.id ?? "n1", nodes, trigger };
}

export function SequenceEditor({
  flowId,
  initial,
  isActive: initialActive,
}: {
  flowId: string;
  initial: Def;
  isActive: boolean;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>(() => defToSteps(initial));
  const [trigger, setTrigger] = useState<Trigger>(initial.trigger ?? { type: "any" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [live, setLive] = useState(initialActive);

  const patch = (id: string, p: Partial<Step>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const remove = (id: string) => setSteps((s) => s.filter((x) => x.id !== id));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  const add = (kind: StepKind, at?: number) => {
    const base: Step =
      kind === "message"
        ? { id: newId(), kind, text: "" }
        : kind === "question"
          ? { id: newId(), kind, prompt: "", field: "", expect: "text" }
          : { id: newId(), kind };
    setSteps((s) => {
      if (at === undefined) return [...s, base];
      const copy = [...s];
      copy.splice(at, 0, base);
      return copy;
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const def = stepsToDef(steps, trigger);
    const res = await saveFlowAction(flowId, JSON.stringify(def));
    setSaving(false);
    if (res.error) {
      setMsg(`${he.saveError}: ${res.error}`);
      return;
    }
    if (res.activated) setLive(true);
    setMsg(res.activated || live ? he.savedLive : he.saved);
    router.refresh();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      {/* Editor column */}
      <div className="space-y-4">
        {/* Live status */}
        <div className={`rounded-xl px-4 py-2 text-sm font-semibold ${live ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          {live ? he.flowLive : he.flowOff}
        </div>

        {/* Trigger */}
        <div className="card-p !bg-emerald-50">
          <div className="text-sm font-bold text-emerald-800">▶ {he.whenStarts}</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="radio" checked={trigger.type === "any"} onChange={() => setTrigger({ type: "any" })} />
              {he.triggerAny}
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="radio" checked={trigger.type === "keyword"} onChange={() => setTrigger({ type: "keyword", keywords: trigger.keywords ?? [] })} />
              {he.triggerKeyword}
            </label>
            {trigger.type === "keyword" && (
              <input
                value={(trigger.keywords ?? []).join(", ")}
                onChange={(e) => setTrigger({ type: "keyword", keywords: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                placeholder={he.triggerKeywordsHint}
                className="input !w-auto flex-1 !py-1.5 text-sm"
              />
            )}
          </div>
        </div>

        <p className="text-sm text-slate-500">{he.seqIntro}</p>

        {steps.length === 0 && (
          <div className="card p-8 text-center text-sm text-slate-400">{he.seqEmpty}</div>
        )}

        {steps.map((s, i) => (
          <div key={s.id}>
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2" style={{ background: `${KIND[s.kind].color}12` }}>
                <span className="text-sm font-bold" style={{ color: KIND[s.kind].color }}>
                  {KIND[s.kind].icon} {he.stepN} {i + 1} · {KIND[s.kind].label}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => move(i, -1)} title={he.moveUp} className="rounded p-1 text-slate-400 hover:bg-white">↑</button>
                  <button onClick={() => move(i, 1)} title={he.moveDown} className="rounded p-1 text-slate-400 hover:bg-white">↓</button>
                  <button onClick={() => remove(s.id)} className="rounded p-1 text-red-400 hover:bg-white">🗑</button>
                </div>
              </div>

              <div className="space-y-2 p-4">
                {s.kind === "message" && (
                  <div>
                    <div className="label">{he.botSends}</div>
                    <textarea value={s.text ?? ""} onChange={(e) => patch(s.id, { text: e.target.value })} placeholder={he.msgPlaceholder} rows={2} className="input" />
                  </div>
                )}
                {s.kind === "question" && (
                  <>
                    <div>
                      <div className="label">{he.botAsks}</div>
                      <textarea value={s.prompt ?? ""} onChange={(e) => patch(s.id, { prompt: e.target.value })} placeholder={he.askPlaceholder} rows={2} className="input" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="label">{he.saveAnswerTo}</div>
                        <input value={s.field ?? ""} onChange={(e) => patch(s.id, { field: e.target.value })} dir="ltr" placeholder={he.fieldPlaceholder} className="input text-left" />
                      </div>
                      <div>
                        <div className="label">{he.answerTypeLabel}</div>
                        <select value={s.expect ?? "text"} onChange={(e) => patch(s.id, { expect: e.target.value })} className="input">
                          {Object.entries(EXPECTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                    {s.expect === "choice" && (
                      <div>
                        <div className="label">{he.choicesLabel}</div>
                        <input value={(s.choices ?? []).join(", ")} onChange={(e) => patch(s.id, { choices: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className="input" />
                      </div>
                    )}
                  </>
                )}
                {s.kind === "book" && <p className="text-sm text-slate-500">{he.bookNote}</p>}
              </div>
            </div>

            <AddBar onAdd={(k) => add(k, i + 1)} />
          </div>
        ))}

        {steps.length === 0 && <AddBar onAdd={(k) => add(k)} />}

        <div className="sticky bottom-0 -mx-1 flex items-center gap-3 bg-canvas/80 py-3 backdrop-blur">
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? "…" : he.saveFlow}</button>
          {msg && <span className="text-sm text-slate-500">{msg}</span>}
        </div>
      </div>

      {/* Live preview column */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="mb-2 text-sm font-semibold text-slate-500">{he.previewTitle}</div>
        <Preview steps={steps} />
      </div>
    </div>
  );
}

function AddBar({ onAdd }: { onAdd: (k: StepKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-center py-1.5">
      {!open ? (
        <button onClick={() => setOpen(true)} className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-xs text-slate-500 hover:border-brand hover:text-brand">
          + {he.addStepMenu}
        </button>
      ) : (
        <div className="z-10 flex flex-wrap justify-center gap-2 rounded-xl border border-line bg-white p-2 shadow-card">
          {(["message", "question", "book"] as StepKind[]).map((k) => (
            <button key={k} onClick={() => { onAdd(k); setOpen(false); }} className="w-40 rounded-lg border border-line p-2 text-right text-xs hover:bg-slate-50">
              <div className="font-semibold text-ink">{KIND[k].icon} {KIND[k].label}</div>
              <div className="mt-0.5 text-[10px] leading-tight text-slate-400">
                {k === "message" ? he.stepMessageDesc : k === "question" ? he.stepQuestionDesc : he.stepBookDesc}
              </div>
            </button>
          ))}
          <button onClick={() => setOpen(false)} className="self-center text-xs text-slate-400">✕</button>
        </div>
      )}
    </div>
  );
}

// WhatsApp-style live preview of the conversation
function Preview({ steps }: { steps: Step[] }) {
  return (
    <div className="rounded-[2rem] border-4 border-slate-800 bg-[#e6ddd4] p-2 shadow-card">
      <div className="rounded-t-2xl bg-[#075E54] px-3 py-2 text-xs font-semibold text-white">הבוט שלך</div>
      <div className="flex min-h-[360px] flex-col gap-2 rounded-b-2xl bg-[#e6ddd4] p-3">
        {steps.length === 0 && <div className="m-auto text-xs text-slate-400">התצוגה תופיע כאן</div>}
        {steps.map((s) => (
          <div key={s.id} className="flex flex-col gap-2">
            {(s.kind === "message" || s.kind === "question") && (s.text || s.prompt) && (
              <Bubble side="bot">{s.kind === "message" ? s.text : s.prompt}</Bubble>
            )}
            {s.kind === "question" && (
              <>
                {s.expect === "choice" && s.choices?.length ? (
                  <div className="flex flex-wrap justify-start gap-1">
                    {s.choices.map((c) => <span key={c} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 shadow">{c}</span>)}
                  </div>
                ) : (
                  <Bubble side="user">{he.previewYouAnswer}</Bubble>
                )}
              </>
            )}
            {s.kind === "book" && (
              <Bubble side="bot">
                בחר/י מועד לשיחה:{"\n"}1. יום ראשון 09:00{"\n"}2. יום ראשון 09:30 …
              </Bubble>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Bubble({ side, children }: { side: "bot" | "user"; children: React.ReactNode }) {
  return (
    <div className={`flex ${side === "bot" ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[80%] whitespace-pre-line rounded-2xl px-3 py-1.5 text-[13px] shadow ${side === "bot" ? "bg-white text-slate-800" : "bg-[#dcf8c6] text-slate-800"}`}>
        {children}
      </div>
    </div>
  );
}
