import { z } from "zod";

/**
 * A flow is a directed graph of nodes stored as JSON per organization.
 * The engine is a pure reducer over this definition — see step.ts.
 */

export const ExpectType = z.enum(["text", "number", "email", "phone", "choice", "date"]);
export type ExpectType = z.infer<typeof ExpectType>;

export const ActionKind = z.enum([
  "save_field",
  "add_tag",
  "notify_agent",
  "assign_owner",
  "book_appointment",
  "webhook",
  "handoff_to_human",
  "end",
]);
export type ActionKind = z.infer<typeof ActionKind>;

const baseNext = z.string().nullable();

export const MessageNode = z.object({
  type: z.literal("message"),
  text: z.string(),
  next: baseNext,
});

export const QuestionNode = z.object({
  type: z.literal("question"),
  field: z.string(),
  prompt: z.string(),
  expect: ExpectType.default("text"),
  choices: z.array(z.string()).optional(),
  next: baseNext,
});

export const ConditionNode = z.object({
  type: z.literal("condition"),
  // MVP: simple "answers.field == value" / "answers.field > n". Full expr lang later.
  when: z.string(),
  then: z.string().nullable(),
  else: z.string().nullable(),
});

export const ActionNode = z.object({
  type: z.literal("action"),
  action: ActionKind,
  params: z.record(z.unknown()).optional(),
  next: baseNext,
});

export const FlowNode = z.discriminatedUnion("type", [
  MessageNode,
  QuestionNode,
  ConditionNode,
  ActionNode,
]);
export type FlowNode = z.infer<typeof FlowNode>;

/**
 * What makes a lead's inbound message start this flow. "any" = catch-all
 * (default greeter); "keyword" = start only when the message matches a keyword.
 * Every flow begins from an inbound webhook event — the trigger defines which.
 */
export const FlowTrigger = z.object({
  type: z.enum(["any", "keyword"]).default("any"),
  keywords: z.array(z.string()).optional(),
});
export type FlowTrigger = z.infer<typeof FlowTrigger>;

export const FlowDefinition = z.object({
  start: z.string(),
  nodes: z.record(FlowNode),
  trigger: FlowTrigger.optional(),
});
export type FlowDefinition = z.infer<typeof FlowDefinition>;

/** True if an inbound message should start a flow with this trigger. */
export function matchesTrigger(trigger: FlowTrigger | undefined, text: string): boolean {
  if (!trigger || trigger.type === "any") return true;
  const t = text.trim().toLowerCase();
  return (trigger.keywords ?? []).some((k) => k.trim() && t.includes(k.trim().toLowerCase()));
}

/** Keyword triggers are more specific than catch-all — used to rank matches. */
export function triggerSpecificity(trigger: FlowTrigger | undefined): number {
  return trigger && trigger.type === "keyword" ? 1 : 0;
}

/** Per-conversation persisted state (stored in Conversation.state). */
export interface FlowState {
  currentNodeId: string | null;
  answers: Record<string, unknown>;
  /** retries for the current waiting question */
  retries: number;
  status: "active" | "completed" | "handoff";
  /** set when the conversation is paused waiting for a booking slot choice */
  awaiting?: "booking";
  /** node to resume at once the pause (e.g. booking) resolves */
  resumeNodeId?: string | null;
  /** worker-populated: slots offered to the lead while awaiting a booking */
  booking?: { offered: Array<{ start: string; end: string }> };
}

export function initialState(flow: FlowDefinition): FlowState {
  return { currentNodeId: flow.start, answers: {}, retries: 0, status: "active" };
}

/** An incoming user event to feed the engine. */
export interface InboundEvent {
  text: string;
}

/** Side effects the runtime (worker) must carry out after a step. */
export type EngineAction =
  | { kind: "send_message"; text: string }
  | { kind: "save_field"; field: string; value: unknown }
  | { kind: "add_tag"; tag: string }
  | { kind: "notify_agent"; params?: Record<string, unknown> }
  | { kind: "assign_owner"; params?: Record<string, unknown> }
  | { kind: "book_appointment"; params?: Record<string, unknown> }
  | { kind: "webhook"; params?: Record<string, unknown> }
  | { kind: "handoff_to_human" }
  | { kind: "end" };

export interface StepResult {
  state: FlowState;
  actions: EngineAction[];
  /** true when the engine is now waiting for the user's next message. */
  awaitingInput: boolean;
}
