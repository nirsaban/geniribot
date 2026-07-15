"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { he } from "@/lib/he";
import { saveFlowAction } from "../../actions";

// ---- raw flow definition types (superset of engine's; keeps _positions) ----
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

const KIND_COLOR: Record<NodeKind, string> = {
  message: "#128C7E",
  question: "#2563eb",
  condition: "#d97706",
  action: "#7c3aed",
};
const KIND_LABEL: Record<NodeKind, string> = {
  message: "הודעה",
  question: "שאלה",
  condition: "תנאי",
  action: "פעולה",
};
const EXPECTS = ["text", "number", "email", "phone", "choice", "date"];
const ACTIONS = [
  "book_appointment",
  "notify_agent",
  "assign_owner",
  "add_tag",
  "handoff_to_human",
  "webhook",
  "end",
];

function summary(n: AnyNode): string {
  if (n.type === "message") return n.text ?? "";
  if (n.type === "question") return n.prompt ?? "";
  if (n.type === "condition") return n.when ?? "";
  return n.action ?? "";
}

// ---- custom React Flow node ----
function KNode({ data, selected }: NodeProps) {
  const kind = data.kind as NodeKind;
  const color = KIND_COLOR[kind];
  return (
    <div
      dir="rtl"
      style={{ borderColor: color, boxShadow: selected ? `0 0 0 2px ${color}` : undefined }}
      className="w-52 rounded-xl border-2 bg-white p-2 text-right text-xs"
    >
      <Handle type="target" position={Position.Top} />
      <div className="mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: color }}>
        {KIND_LABEL[kind]}
      </div>
      {data.isStart ? <span className="mr-1 text-[10px] text-green-600">● התחלה</span> : null}
      <div className="truncate text-gray-700">{(data.summary as string) || "—"}</div>
      {kind === "condition" ? (
        <>
          <Handle id="then" type="source" position={Position.Bottom} style={{ right: "25%", background: "#16a34a" }} />
          <Handle id="else" type="source" position={Position.Bottom} style={{ right: "75%", background: "#dc2626" }} />
        </>
      ) : (
        <Handle id="next" type="source" position={Position.Bottom} />
      )}
    </div>
  );
}
const nodeTypes = { k: KNode };

export function FlowEditor({
  flowId,
  initial,
}: {
  flowId: string;
  initial: Def;
}) {
  const router = useRouter();
  const [def, setDef] = useState<Def>(() => ({
    start: initial.start,
    nodes: initial.nodes,
    trigger: initial.trigger ?? { type: "any" },
    _positions: initial._positions ?? {},
  }));
  const trigger = def.trigger ?? { type: "any" };
  const setTrigger = (t: Trigger) => setDef((d) => ({ ...d, trigger: t }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const ids = Object.keys(def.nodes);

  const rfNodes: Node[] = useMemo(
    () =>
      ids.map((id, i) => {
        const n = def.nodes[id]!;
        return {
          id,
          type: "k",
          position: def._positions?.[id] ?? { x: 250, y: i * 110 },
          data: { kind: n.type, summary: summary(n), isStart: id === def.start },
          selected: id === selectedId,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def, selectedId],
  );

  const rfEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
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

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setDef((d) => {
      const positions = { ...(d._positions ?? {}) };
      const applied = applyNodeChanges(changes, rfNodes);
      for (const node of applied) positions[node.id] = node.position;
      return { ...d, _positions: positions };
    });
  }, [rfNodes]);

  const patchNode = (id: string, patch: Partial<AnyNode>) =>
    setDef((d) => ({ ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id]!, ...patch } } }));

  const addNode = (kind: NodeKind) => {
    const nums = ids.map((i) => Number(i.replace(/\D/g, "")) || 0);
    const id = "n" + (Math.max(0, ...nums) + 1);
    const base: AnyNode =
      kind === "message"
        ? { type: "message", text: "הודעה חדשה", next: null }
        : kind === "question"
          ? { type: "question", field: "field", prompt: "שאלה?", expect: "text", next: null }
          : kind === "condition"
            ? { type: "condition", when: "answers.field == 'x'", then: null, else: null }
            : { type: "action", action: "notify_agent", next: null };
    setDef((d) => ({
      ...d,
      nodes: { ...d.nodes, [id]: base },
      _positions: { ...(d._positions ?? {}), [id]: { x: 500, y: 40 } },
    }));
    setSelectedId(id);
  };

  const deleteNode = (id: string) => {
    setDef((d) => {
      const nodes = { ...d.nodes };
      delete nodes[id];
      // clear any references to the deleted node
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

  const sel = selectedId ? def.nodes[selectedId] : null;
  const targetOptions = (
    <>
      <option value="">— {he.endNode} —</option>
      {ids.filter((i) => i !== selectedId).map((i) => (
        <option key={i} value={i}>
          {i}: {summary(def.nodes[i]!).slice(0, 20)}
        </option>
      ))}
    </>
  );

  return (
    <div className="flex h-[70vh] gap-4">
      <div className="flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <aside className="w-72 shrink-0 space-y-3 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4">
        {/* Trigger — the first thing you define: what starts this flow */}
        <div className="rounded-xl bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-900">{he.triggerTitle}</div>
          <p className="mb-2 mt-0.5 text-[11px] text-amber-700">{he.triggerDesc}</p>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              checked={trigger.type === "any"}
              onChange={() => setTrigger({ type: "any" })}
            />
            {he.triggerAny}
          </label>
          <label className="mt-1 flex items-center gap-2 text-xs">
            <input
              type="radio"
              checked={trigger.type === "keyword"}
              onChange={() => setTrigger({ type: "keyword", keywords: trigger.keywords ?? [] })}
            />
            {he.triggerKeyword}
          </label>
          {trigger.type === "keyword" && (
            <label className="mt-2 block text-xs">
              <span className="text-amber-800">{he.triggerKeywordsLabel}</span>
              <input
                value={(trigger.keywords ?? []).join(", ")}
                onChange={(e) =>
                  setTrigger({
                    type: "keyword",
                    keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder={he.triggerKeywordsHint}
                className="mt-1 w-full rounded border border-amber-300 p-1"
              />
            </label>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {(["message", "question", "condition", "action"] as NodeKind[]).map((k) => (
            <button
              key={k}
              onClick={() => addNode(k)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
            >
              + {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <label className="block text-xs">
          <span className="text-gray-500">{he.startNode}</span>
          <select
            value={def.start}
            onChange={(e) => setDef((d) => ({ ...d, start: e.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 p-1"
          >
            {ids.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </label>

        <hr />

        {!sel ? (
          <p className="text-xs text-gray-400">{he.selectNode}</p>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="font-semibold">{KIND_LABEL[sel.type]} · {selectedId}</div>

            {sel.type === "message" && (
              <Field label={he.fMessage}>
                <textarea value={sel.text ?? ""} onChange={(e) => patchNode(selectedId!, { text: e.target.value })} className="w-full rounded border border-gray-300 p-1" rows={3} />
              </Field>
            )}

            {sel.type === "question" && (
              <>
                <Field label={he.fPrompt}>
                  <textarea value={sel.prompt ?? ""} onChange={(e) => patchNode(selectedId!, { prompt: e.target.value })} className="w-full rounded border border-gray-300 p-1" rows={2} />
                </Field>
                <Field label={he.fField}>
                  <input value={sel.field ?? ""} onChange={(e) => patchNode(selectedId!, { field: e.target.value })} className="w-full rounded border border-gray-300 p-1" />
                </Field>
                <Field label={he.fExpect}>
                  <select value={sel.expect ?? "text"} onChange={(e) => patchNode(selectedId!, { expect: e.target.value })} className="w-full rounded border border-gray-300 p-1">
                    {EXPECTS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </Field>
                {sel.expect === "choice" && (
                  <Field label={he.fChoices}>
                    <input value={(sel.choices ?? []).join(", ")} onChange={(e) => patchNode(selectedId!, { choices: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} className="w-full rounded border border-gray-300 p-1" />
                  </Field>
                )}
              </>
            )}

            {sel.type === "condition" && (
              <>
                <Field label={he.fWhen}>
                  <input value={sel.when ?? ""} onChange={(e) => patchNode(selectedId!, { when: e.target.value })} className="w-full rounded border border-gray-300 p-1" dir="ltr" />
                </Field>
                <Field label={`${he.fThen} (כן)`}>
                  <select value={sel.then ?? ""} onChange={(e) => patchNode(selectedId!, { then: e.target.value || null })} className="w-full rounded border border-gray-300 p-1">{targetOptions}</select>
                </Field>
                <Field label={`${he.fElse} (לא)`}>
                  <select value={sel.else ?? ""} onChange={(e) => patchNode(selectedId!, { else: e.target.value || null })} className="w-full rounded border border-gray-300 p-1">{targetOptions}</select>
                </Field>
              </>
            )}

            {sel.type === "action" && (
              <Field label={he.fAction}>
                <select value={sel.action ?? "notify_agent"} onChange={(e) => patchNode(selectedId!, { action: e.target.value })} className="w-full rounded border border-gray-300 p-1">
                  {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
            )}

            {sel.type !== "condition" && (
              <Field label={he.fNext}>
                <select value={sel.next ?? ""} onChange={(e) => patchNode(selectedId!, { next: e.target.value || null })} className="w-full rounded border border-gray-300 p-1">{targetOptions}</select>
              </Field>
            )}

            <button onClick={() => deleteNode(selectedId!)} className="w-full rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50">
              {he.deleteNode}
            </button>
          </div>
        )}

        <hr />
        <button onClick={save} disabled={saving} className="w-full rounded-lg bg-brand py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
          {saving ? "…" : he.saveFlow}
        </button>
        {msg && <p className="text-center text-xs text-gray-600">{msg}</p>}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-gray-500">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
