import { z } from "zod";
import { ExpectType, type FlowDefinition, type FlowNode } from "./types.js";

/**
 * The canonical description of one field a scenario collects.
 *
 * Field names are typed free-hand in the bot builder, so before this existed
 * the CRM only learned a field existed once some lead happened to fill it, had
 * no label for it, and could not tell a date from a number — every value was
 * rendered as a raw `key: value` string. Deriving the set from the flow makes
 * it a fixed contract for the whole campaign: every lead from a scenario has
 * the same columns, in the same order, whether or not they answered.
 */
export const FieldSpec = z.object({
  key: z.string(),
  label: z.string(),
  expect: ExpectType,
  choices: z.array(z.string()).optional(),
  /** Position in the conversation — the order the CRM shows columns in. */
  order: z.number().int(),
});
export type FieldSpec = z.infer<typeof FieldSpec>;

export const FieldSchema = z.array(FieldSpec);
export type FieldSchema = z.infer<typeof FieldSchema>;

/** `contact_city` / `contactCity` → "contact city", for use as a fallback label. */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const LABEL_MAX = 40;

/**
 * A question's prompt is the only human-meaningful text we have, so it becomes
 * the column label — minus the trailing punctuation and emoji that read fine in
 * chat but not in a table header. Falls back to the humanized key when a prompt
 * is empty or is pure decoration.
 */
function labelFromPrompt(prompt: string, key: string): string {
  const cleaned = prompt
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "")
    .replace(/[?!:.،,]+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return humanizeKey(key);
  return cleaned.length > LABEL_MAX ? `${cleaned.slice(0, LABEL_MAX - 1).trimEnd()}…` : cleaned;
}

/** Every node id reachable from `start`, in conversation order. */
function reachableInOrder(flow: FlowDefinition): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const queue: string[] = [flow.start];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    const node = flow.nodes[id];
    if (!node) continue;
    seen.add(id);
    ordered.push(id);

    if (node.type === "condition") {
      // Depth-first down the `then` branch first so the happy path keeps its
      // natural order; `else` fields follow.
      if (node.then) queue.unshift(node.then);
      if (node.else) queue.push(node.else);
    } else if (node.next) {
      queue.unshift(node.next);
    }
  }
  return ordered;
}

/** The field a node contributes, if any. */
function fieldOf(node: FlowNode): { key: string; expect: ExpectType; choices?: string[]; prompt?: string } | null {
  if (node.type === "question") {
    return { key: node.field, expect: node.expect, choices: node.choices, prompt: node.prompt };
  }
  if (node.type === "action" && node.action === "save_field") {
    const key = node.params?.field;
    if (typeof key === "string" && key.trim()) return { key, expect: "text" };
  }
  return null;
}

/**
 * Derive the canonical field set from a flow definition.
 *
 * Ordered by walking the graph from `start`, so columns appear in the order the
 * bot asks for them. Nodes unreachable from `start` are still included (appended
 * in declaration order) — an unreachable branch is usually a half-finished edit
 * rather than an intent to drop the data, and silently losing its fields would
 * make historical values un-renderable.
 */
export function deriveFieldSchema(flow: FlowDefinition): FieldSchema {
  const reachable = reachableInOrder(flow);
  const rest = Object.keys(flow.nodes).filter((id) => !reachable.includes(id));

  const byKey = new Map<string, FieldSpec>();
  for (const id of [...reachable, ...rest]) {
    const node = flow.nodes[id];
    if (!node) continue;
    const f = fieldOf(node);
    if (!f) continue;
    const key = f.key.trim();
    if (!key) continue;

    const existing = byKey.get(key);
    if (existing) {
      // The same field asked more than once (e.g. re-asked in another branch):
      // one column, but union the choices so a filter offers every option.
      if (f.choices?.length) {
        existing.choices = [...new Set([...(existing.choices ?? []), ...f.choices])];
      }
      continue;
    }
    byKey.set(key, {
      key,
      label: f.prompt ? labelFromPrompt(f.prompt, key) : humanizeKey(key),
      expect: f.expect,
      ...(f.choices?.length ? { choices: f.choices } : {}),
      order: byKey.size,
    });
  }
  return [...byKey.values()];
}

/**
 * Read a persisted `Flow.fieldSchema`, tolerating rows written before the column
 * existed (or by an older shape) by returning null so the caller can re-derive.
 */
export function parseFieldSchema(raw: unknown): FieldSchema | null {
  const parsed = FieldSchema.safeParse(raw);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}
