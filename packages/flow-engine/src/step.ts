import type {
  EngineAction,
  ExpectType,
  FlowDefinition,
  FlowNode,
  FlowState,
  InboundEvent,
  StepResult,
} from "./types.js";

/**
 * The flow engine is a PURE reducer. It performs no I/O — it takes a flow
 * definition, the current conversation state, and (optionally) an inbound
 * message, and returns the next state plus a list of side effects for the
 * runtime to execute. This is what makes the bot brain reusable and testable.
 */

/** Begin (or restart) a flow: walk from the start node until we wait or end. */
export function start(flow: FlowDefinition): StepResult {
  const state: FlowState = {
    currentNodeId: flow.start,
    answers: {},
    retries: 0,
    status: "active",
  };
  return walk(flow, state, []);
}

/** Advance the flow with the user's reply to the current question. */
export function step(
  flow: FlowDefinition,
  state: FlowState,
  event: InboundEvent,
): StepResult {
  if (state.status !== "active" || !state.currentNodeId) {
    return { state, actions: [], awaitingInput: false };
  }
  const node = flow.nodes[state.currentNodeId];
  if (!node || node.type !== "question") {
    // Not waiting on a question; treat the message as a nudge to continue.
    return walk(flow, { ...state, retries: 0 }, []);
  }

  const parsed = coerce(event.text, node.expect, node.choices);
  if (!parsed.ok) {
    const retries = state.retries + 1;
    const hint =
      node.expect === "choice" && node.choices
        ? ` (${node.choices.join(" / ")})`
        : "";
    return {
      state: { ...state, retries },
      actions: [{ kind: "send_message", text: `${parsed.message}${hint}` }],
      awaitingInput: true,
    };
  }

  const answers = { ...state.answers, [node.field]: parsed.value };
  const actions: EngineAction[] = [
    { kind: "save_field", field: node.field, value: parsed.value },
  ];
  const next: FlowState = {
    ...state,
    answers,
    retries: 0,
    currentNodeId: node.next,
  };
  return walk(flow, next, actions);
}

/**
 * Walk non-waiting nodes (message / condition / action) starting from
 * state.currentNodeId, accumulating actions, until we hit a question (wait),
 * an end action, or run out of nodes (complete).
 */
function walk(
  flow: FlowDefinition,
  state: FlowState,
  actions: EngineAction[],
): StepResult {
  let current = state.currentNodeId;
  const acc = [...actions];
  const answers = { ...state.answers };
  const guardMax = 1000; // cycle guard
  let steps = 0;

  while (current) {
    if (++steps > guardMax) {
      throw new Error("flow-engine: node walk exceeded max steps (cycle?)");
    }
    const node: FlowNode | undefined = flow.nodes[current];
    if (!node) {
      // dangling reference → end gracefully
      return finish(state, answers, acc);
    }

    if (node.type === "question") {
      acc.push({ kind: "send_message", text: node.prompt });
      return {
        state: { ...state, answers, currentNodeId: current, retries: 0, status: "active" },
        actions: acc,
        awaitingInput: true,
      };
    }

    if (node.type === "message") {
      acc.push({ kind: "send_message", text: node.text });
      current = node.next;
      continue;
    }

    if (node.type === "condition") {
      current = evalCondition(node.when, answers) ? node.then : node.else;
      continue;
    }

    // action node
    const effect = actionToEffect(node.action, node.params);
    if (effect) acc.push(effect);
    if (node.action === "end") {
      return finish({ ...state, status: "completed" }, answers, acc);
    }
    if (node.action === "handoff_to_human") {
      return finish({ ...state, status: "handoff" }, answers, acc);
    }
    current = node.next;
  }

  return finish({ ...state, status: "completed" }, answers, acc);
}

function finish(
  state: FlowState,
  answers: Record<string, unknown>,
  actions: EngineAction[],
): StepResult {
  const status = state.status === "active" ? "completed" : state.status;
  return {
    state: { ...state, answers, currentNodeId: null, retries: 0, status },
    actions,
    awaitingInput: false,
  };
}

function actionToEffect(
  action: string,
  params?: Record<string, unknown>,
): EngineAction | null {
  switch (action) {
    case "save_field":
      return params && "field" in params
        ? { kind: "save_field", field: String(params.field), value: params.value }
        : null;
    case "add_tag":
      return params && "tag" in params ? { kind: "add_tag", tag: String(params.tag) } : null;
    case "notify_agent":
      return { kind: "notify_agent", params };
    case "assign_owner":
      return { kind: "assign_owner", params };
    case "book_appointment":
      return { kind: "book_appointment", params };
    case "webhook":
      return { kind: "webhook", params };
    case "handoff_to_human":
      return { kind: "handoff_to_human" };
    case "end":
      return { kind: "end" };
    default:
      return null;
  }
}

// ---------- Input coercion / validation ----------
type Coerced = { ok: true; value: unknown } | { ok: false; message: string };

function coerce(raw: string, expect: ExpectType, choices?: string[]): Coerced {
  const text = raw.trim();
  switch (expect) {
    case "text":
      return text.length > 0
        ? { ok: true, value: text }
        : { ok: false, message: "אפשר לכתוב תשובה?" };
    case "number": {
      const n = Number(text.replace(/,/g, ""));
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : { ok: false, message: "צריך מספר" };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, message: "כתובת אימייל לא תקינה" };
    case "phone": {
      const digits = text.replace(/[^\d+]/g, "");
      return digits.replace(/\D/g, "").length >= 7
        ? { ok: true, value: digits }
        : { ok: false, message: "מספר טלפון לא תקין" };
    }
    case "date": {
      const t = Date.parse(text);
      return Number.isFinite(t)
        ? { ok: true, value: new Date(t).toISOString() }
        : { ok: false, message: "תאריך לא תקין" };
    }
    case "choice": {
      if (!choices || choices.length === 0) return { ok: true, value: text };
      // match by exact text or 1-based index
      const byIndex = Number(text);
      if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= choices.length) {
        return { ok: true, value: choices[byIndex - 1] };
      }
      const hit = choices.find((c) => c.toLowerCase() === text.toLowerCase());
      return hit
        ? { ok: true, value: hit }
        : { ok: false, message: "בחירה לא מוכרת, נסה שוב" };
    }
    default:
      return { ok: true, value: text };
  }
}

// ---------- Minimal condition evaluator ----------
// Supports: answers.<field> <op> <literal>   where op ∈ == != > >= < <=
const CONDITION_RE = /^\s*answers\.([\w$]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/;

export function evalCondition(expr: string, answers: Record<string, unknown>): boolean {
  const m = CONDITION_RE.exec(expr);
  if (!m) return false;
  const [, field, op, rhsRaw] = m as unknown as [string, string, string, string];
  const lhs = answers[field];
  const rhs = parseLiteral(rhsRaw);

  switch (op) {
    case "==":
      return looseEq(lhs, rhs);
    case "!=":
      return !looseEq(lhs, rhs);
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const a = Number(lhs);
      const b = Number(rhs);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;
    }
    default:
      return false;
  }
}

function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  if (Number.isFinite(n) && s !== "") return n;
  return s;
}

function looseEq(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}
