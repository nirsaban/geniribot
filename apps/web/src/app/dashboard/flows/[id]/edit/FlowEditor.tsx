"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { he } from "@/lib/he";
import { saveFlowAction } from "../../actions";

type XY = { x: number; y: number };
type NodeKind = "message" | "question" | "condition" | "action";
interface AnyNode {
  type: NodeKind;
  text?: string;
  field?: string;
  prompt?: string;
  expect?: string;
  choices?: string[];
  when?: string;
  then?: string | null;
  else?: string | null;
  action?: string;
  next?: string | null;
}
interface Trigger {
  type: "any" | "keyword";
  keywords?: string[];
}
interface Def {
  start: string;
  nodes: Record<string, AnyNode>;
  trigger?: Trigger;
  _positions?: Record<string, XY>;
}

const START = "__start";

const KIND_META: Record<NodeKind, { color: string; icon: string; label: string; desc: string }> = {
  message: { color: "#0d9488", icon: "💬", label: he.nodeKindMessage, desc: he.nodeDescMessage },
  question: { color: "#2563eb", icon: "❓", label: he.nodeKindQuestion, desc: he.nodeDescQuestion },
  condition: { color: "#d97706", icon: "🔀", label: he.nodeKindCondition, desc: he.nodeDescCondition },
  action: { color: "#7c3aed", icon: "⚡", label: he.nodeKindAction, desc: he.nodeDescAction },
};
const EXPECTS: Record<string, string> = {
  text: "טקסט חופשי",
  number: "מספר",
  email: "אימייל",
  phone: "טלפון",
  choice: "בחירה מרשימה",
  date: "תאריך",
};
const ACTIONS: Record<string, string> = {
  book_appointment: "📅 קביעת פגישה",
  notify_agent: "🔔 התראה לנציג",
  assign_owner: "👤 שיוך לנציג",
  add_tag: "🏷️ הוספת תגית",
  handoff_to_human: "🙋 העברה לנציג אנושי",
  webhook: "🌐 שליחת Webhook",
  end: "🏁 סיום השיחה",
};

function summary(n: AnyNode): string {
  if (n.type === "message") return n.text ?? "";
  if (n.type === "question") return n.prompt ?? "";
  if (n.type === "condition") return n.when ?? "";
  return ACTIONS[n.action ?? ""] ?? n.action ?? "";
}

// ---- Trigger start node ----
function StartNode({ data, selected }: NodeProps) {
  return (
    <div
      dir="rtl"
      style={{ boxShadow: selected ? "0 0 0 2px #10b981" : undefined }}
      className="w-56 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-3 text-right"
    >
      <div className="mb-1 inline-flex items-center gap-1 rounded-md bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
        ▶ {he.startNodeTitle}
      </div>
      <div className="text-xs font-medium text-emerald-800">{data.summary as string}</div>
      <Handle id="next" type="source" position={Position.Bottom} style={{ background: "#10b981", width: 10, height: 10 }} />
    </div>
  );
}

// ---- Regular node ----
function KNode({ data, selected }: NodeProps) {
  const kind = data.kind as NodeKind;
  const meta = KIND_META[kind];
  return (
    <div
      dir="rtl"
      style={{ borderColor: meta.color, boxShadow: selected ? `0 0 0 2px ${meta.color}` : undefined }}
      className="w-56 rounded-2xl border-2 bg-white p-2.5 text-right"
    >
      <Handle type="target" position={Position.Top} style={{ width: 10, height: 10 }} />
      <div className="mb-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: meta.color }}>
        {meta.icon} {meta.label}
      </div>
      <div className="line-clamp-2 text-xs text-slate-700">{(data.summary as string) || "—"}</div>
      {kind === "question" && data.field ? (
        <div className="mt-1.5 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
          {he.savesTo}: {data.field as string}
        </div>
      ) : null}
      {kind === "condition" ? (
        <>
          <div className="mt-1 flex justify-between px-1 text-[9px] font-bold">
            <span className="text-red-500">לא ▸</span>
            <span className="text-green-600">◂ כן</span>
          </div>
          <Handle id="then" type="source" position={Position.Bottom} style={{ right: "26%", background: "#16a34a", width: 10, height: 10 }} />
          <Handle id="else" type="source" position={Position.Bottom} style={{ right: "74%", background: "#dc2626", width: 10, height: 10 }} />
        </>
      ) : (
        <Handle id="next" type="source" position={Position.Bottom} style={{ width: 10, height: 10 }} />
      )}
    </div>
  );
}
const nodeTypes = { k: KNode, start: StartNode };

export function FlowEditor({ flowId, initial }: { flowId: string; initial: Def }) {
  const router = useRouter();
  const [def, setDef] = useState<Def>(() => ({
    start: initial.start,
    nodes: initial.nodes,
    trigger: initial.trigger ?? { type: "any" },
    _positions: initial._positions ?? {},
  }));
  const [selectedId, setSelectedId] = useState<string | null>(START);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const trigger = def.trigger ?? { type: "any" };
  const setTrigger = (t: Trigger) => setDef((d) => ({ ...d, trigger: t }));
  const ids = Object.keys(def.nodes);

  const triggerSummary =
    trigger.type === "keyword"
      ? `${he.startNodeKeyword} ${(trigger.keywords ?? []).join(", ") || "…"}`
      : he.startNodeAny;

  const rfNodes: Node[] = useMemo(() => {
    const list: Node[] = [
      {
        id: START,
        type: "start",
        position: def._positions?.[START] ?? { x: 240, y: -90 },
        data: { summary: triggerSummary },
        selected: selectedId === START,
      },
    ];
    ids.forEach((id, i) => {
      const n = def.nodes[id]!;
      list.push({
        id,
        type: "k",
        position: def._positions?.[id] ?? { x: 240, y: i * 120 },
        data: { kind: n.type, summary: summary(n), field: n.field },
        selected: id === selectedId,
      });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, selectedId, triggerSummary]);

  const rfEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    if (def.start && def.nodes[def.start]) {
      edges.push({ id: "start-e", source: START, sourceHandle: "next", target: def.start, animated: true, style: { stroke: "#10b981" } });
    }
    for (const id of ids) {
      const n = def.nodes[id]!;
      if (n.type === "condition") {
        if (n.then) edges.push({ id: `${id}-t`, source: id, sourceHandle: "then", target: n.then, label: "כן", style: { stroke: "#16a34a" } });
        if (n.else) edges.push({ id: `${id}-e`, source: id, sourceHandle: "else", target: n.else, label: "לא", style: { stroke: "#dc2626" } });
      } else if (n.next) {
        edges.push({ id: `${id}-n`, source: id, sourceHandle: "next", target: n.next });
      }
    }
    return edges;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setDef((d) => {
        const positions = { ...(d._positions ?? {}) };
        const applied = applyNodeChanges(changes, rfNodes);
        for (const node of applied) positions[node.id] = node.position;
        return { ...d, _positions: positions };
      });
    },
    [rfNodes],
  );

  // Draw connections by dragging between handles.
  const onConnect = useCallback((c: Connection) => {
    setDef((d) => {
      if (!c.target || c.target === START) return d;
      if (c.source === START) return { ...d, start: c.target };
      const n = d.nodes[c.source]; if (!n) return d;
      const nn = { ...n };
      if (n.type === "condition") {
        if (c.sourceHandle === "then") nn.then = c.target;
        else if (c.sourceHandle === "else") nn.else = c.target;
      } else nn.next = c.target;
      return { ...d, nodes: { ...d.nodes, [c.source]: nn } };
    });
  }, []);

  const onEdgesDelete = useCallback((edges: Edge[]) => {
    setDef((d) => {
      const nodes = { ...d.nodes };
      for (const e of edges) {
        if (e.source === START) continue;
        const n = nodes[e.source]; if (!n) continue;
        const nn = { ...n };
        if (e.sourceHandle === "then") nn.then = null;
        else if (e.sourceHandle === "else") nn.else = null;
        else nn.next = null;
        nodes[e.source] = nn;
      }
      return { ...d, nodes };
    });
  }, []);

  const patchNode = (id: string, patch: Partial<AnyNode>) =>
    setDef((d) => ({ ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id]!, ...patch } } }));

  const addNode = (kind: NodeKind) => {
    const nums = ids.map((i) => Number(i.replace(/\D/g, "")) || 0);
    const id = "n" + (Math.max(0, ...nums) + 1);
    const base: AnyNode =
      kind === "message"
        ? { type: "message", text: "כתוב/י כאן הודעה…", next: null }
        : kind === "question"
          ? { type: "question", field: "field" + id, prompt: "מה השאלה?", expect: "text", next: null }
          : kind === "condition"
            ? { type: "condition", when: "answers.field == 'ערך'", then: null, else: null }
            : { type: "action", action: "book_appointment", next: null };
    setDef((d) => ({
      ...d,
      start: d.start && d.nodes[d.start] ? d.start : id,
      nodes: { ...d.nodes, [id]: base },
      _positions: { ...(d._positions ?? {}), [id]: { x: 240 + (ids.length % 2 ? 300 : 0), y: 60 + ids.length * 40 } },
    }));
    setSelectedId(id);
  };

  const deleteNode = (id: string) => {
    setDef((d) => {
      const nodes = { ...d.nodes };
      delete nodes[id];
      for (const k of Object.keys(nodes)) {
        const n = { ...nodes[k]! };
        if (n.next === id) n.next = null;
        if (n.then === id) n.then = null;
        if (n.else === id) n.else = null;
        nodes[k] = n;
      }
      const positions = { ...(d._positions ?? {}) };
      delete positions[id];
      const start = d.start === id ? (Object.keys(nodes)[0] ?? "") : d.start;
      return { ...d, nodes, _positions: positions, start };
    });
    setSelectedId(null);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const res = await saveFlowAction(flowId, JSON.stringify(def));
    setSaving(false);
    setMsg(res.error ? `${he.saveError}: ${res.error}` : he.saved);
    if (!res.error) router.refresh();
  };

  const sel = selectedId && selectedId !== START ? def.nodes[selectedId] : null;
  const targetOptions = (
    <>
      <option value="">— {he.endNode} —</option>
      {ids.filter((i) => i !== selectedId).map((i) => (
        <option key={i} value={i}>{i}: {summary(def.nodes[i]!).slice(0, 20)}</option>
      ))}
    </>
  );

  return (
    <div className="flex h-[72vh] gap-4">
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-line bg-white">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-white/90 px-2 py-1 text-[11px] text-slate-500 shadow">
          {he.dragHint}
        </div>
      </div>

      <aside className="w-72 shrink-0 space-y-3 overflow-y-auto rounded-2xl border border-line bg-white p-4">
        {/* Add step */}
        <div>
          <div className="mb-1.5 text-xs font-semibold text-slate-500">{he.addStep}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(["message", "question", "condition", "action"] as NodeKind[]).map((k) => (
              <button
                key={k}
                onClick={() => addNode(k)}
                title={KIND_META[k].desc}
                className="rounded-xl border border-line px-2 py-2 text-right text-xs hover:bg-slate-50"
              >
                <div className="font-semibold text-ink">{KIND_META[k].icon} {KIND_META[k].label}</div>
                <div className="mt-0.5 text-[10px] leading-tight text-slate-400">{KIND_META[k].desc}</div>
              </button>
            ))}
          </div>
        </div>

        <hr className="border-line" />

        {/* START selected → trigger editor */}
        {selectedId === START && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-emerald-700">▶ {he.triggerTitle}</div>
            <p className="text-[11px] text-slate-500">{he.triggerDesc}</p>
            <label className="flex items-center gap-2 text-xs">
              <input type="radio" checked={trigger.type === "any"} onChange={() => setTrigger({ type: "any" })} />
              {he.triggerAny}
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="radio" checked={trigger.type === "keyword"} onChange={() => setTrigger({ type: "keyword", keywords: trigger.keywords ?? [] })} />
              {he.triggerKeyword}
            </label>
            {trigger.type === "keyword" && (
              <input
                value={(trigger.keywords ?? []).join(", ")}
                onChange={(e) => setTrigger({ type: "keyword", keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder={he.triggerKeywordsHint}
                className="input !py-1.5 text-xs"
              />
            )}
          </div>
        )}

        {/* Node property panel */}
        {selectedId && selectedId !== START && !sel && <p className="text-xs text-slate-400">{he.selectNode}</p>}
        {sel && (
          <div className="space-y-2 text-xs">
            <div className="font-semibold text-ink">{KIND_META[sel.type].icon} {KIND_META[sel.type].label}</div>

            {sel.type === "message" && (
              <Field label={he.fMessage}>
                <textarea value={sel.text ?? ""} onChange={(e) => patchNode(selectedId!, { text: e.target.value })} className="input !py-1.5 text-xs" rows={3} />
              </Field>
            )}

            {sel.type === "question" && (
              <>
                <Field label={he.chooseWhatToAsk}>
                  <textarea value={sel.prompt ?? ""} onChange={(e) => patchNode(selectedId!, { prompt: e.target.value })} className="input !py-1.5 text-xs" rows={2} />
                </Field>
                <Field label={he.chooseFieldName}>
                  <input value={sel.field ?? ""} onChange={(e) => patchNode(selectedId!, { field: e.target.value })} dir="ltr" className="input !py-1.5 text-left text-xs" />
                  <p className="mt-1 text-[10px] leading-tight text-blue-600">{he.questionSaveHint}</p>
                </Field>
                <Field label={he.chooseAnswerType}>
                  <select value={sel.expect ?? "text"} onChange={(e) => patchNode(selectedId!, { expect: e.target.value })} className="input !py-1.5 text-xs">
                    {Object.entries(EXPECTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                {sel.expect === "choice" && (
                  <Field label={he.fChoices}>
                    <input value={(sel.choices ?? []).join(", ")} onChange={(e) => patchNode(selectedId!, { choices: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} className="input !py-1.5 text-xs" />
                  </Field>
                )}
              </>
            )}

            {sel.type === "condition" && (
              <>
                <Field label={he.fWhen}>
                  <input value={sel.when ?? ""} onChange={(e) => patchNode(selectedId!, { when: e.target.value })} dir="ltr" className="input !py-1.5 text-left text-xs" />
                </Field>
                <Field label={`${he.fThen} (כן — ירוק)`}>
                  <select value={sel.then ?? ""} onChange={(e) => patchNode(selectedId!, { then: e.target.value || null })} className="input !py-1.5 text-xs">{targetOptions}</select>
                </Field>
                <Field label={`${he.fElse} (לא — אדום)`}>
                  <select value={sel.else ?? ""} onChange={(e) => patchNode(selectedId!, { else: e.target.value || null })} className="input !py-1.5 text-xs">{targetOptions}</select>
                </Field>
              </>
            )}

            {sel.type === "action" && (
              <Field label={he.chooseAction}>
                <select value={sel.action ?? "book_appointment"} onChange={(e) => patchNode(selectedId!, { action: e.target.value })} className="input !py-1.5 text-xs">
                  {Object.entries(ACTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            )}

            {sel.type !== "condition" && (
              <Field label={he.fNext}>
                <select value={sel.next ?? ""} onChange={(e) => patchNode(selectedId!, { next: e.target.value || null })} className="input !py-1.5 text-xs">{targetOptions}</select>
              </Field>
            )}

            <button onClick={() => deleteNode(selectedId!)} className="btn-danger btn-sm w-full">{he.deleteNode}</button>
          </div>
        )}

        <hr className="border-line" />
        <button onClick={save} disabled={saving} className="btn-primary w-full">{saving ? "…" : he.saveFlow}</button>
        {msg && <p className="text-center text-xs text-slate-500">{msg}</p>}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-slate-500">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
