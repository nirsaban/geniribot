import { describe, expect, it } from "vitest";
import { deriveFieldSchema, parseFieldSchema } from "./fields.js";
import { FlowDefinition } from "./types.js";

const flow = (nodes: Record<string, unknown>, start = "n1"): FlowDefinition =>
  FlowDefinition.parse({ start, nodes });

describe("deriveFieldSchema", () => {
  it("returns fields in the order the bot asks for them", () => {
    const def = flow({
      n1: { type: "question", field: "city", prompt: "מאיפה אתה?", expect: "text", next: "n2" },
      n2: { type: "message", text: "מעולה", next: "n3" },
      n3: { type: "question", field: "budget", prompt: "מה התקציב?", expect: "number", next: null },
    });
    expect(deriveFieldSchema(def).map((f) => f.key)).toEqual(["city", "budget"]);
    expect(deriveFieldSchema(def).map((f) => f.order)).toEqual([0, 1]);
  });

  it("carries the expect type and choices through", () => {
    const def = flow({
      n1: {
        type: "question",
        field: "service",
        prompt: "איזה שירות?",
        expect: "choice",
        choices: ["ייעוץ", "הדרכה"],
        next: null,
      },
    });
    const [spec] = deriveFieldSchema(def);
    expect(spec).toMatchObject({ key: "service", expect: "choice", choices: ["ייעוץ", "הדרכה"] });
  });

  it("strips emoji and trailing punctuation from the prompt to build a label", () => {
    const def = flow({
      n1: { type: "question", field: "name", prompt: "ומה השם שלך? 👋", expect: "text", next: null },
    });
    expect(deriveFieldSchema(def)[0]?.label).toBe("ומה השם שלך");
  });

  it("falls back to a humanized key when the prompt is only decoration", () => {
    const def = flow({
      n1: { type: "question", field: "contact_city", prompt: "🙏", expect: "text", next: null },
    });
    expect(deriveFieldSchema(def)[0]?.label).toBe("Contact city");
  });

  it("collapses a field asked twice into one column, unioning its choices", () => {
    const def = flow({
      n1: { type: "condition", when: "answers.x == 1", then: "n2", else: "n3" },
      n2: { type: "question", field: "size", prompt: "גודל?", expect: "choice", choices: ["S"], next: null },
      n3: { type: "question", field: "size", prompt: "גודל?", expect: "choice", choices: ["L"], next: null },
    });
    const specs = deriveFieldSchema(def);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.choices?.sort()).toEqual(["L", "S"]);
  });

  it("includes save_field action nodes", () => {
    const def = flow({
      n1: { type: "action", action: "save_field", params: { field: "utm", value: "wa" }, next: null },
    });
    expect(deriveFieldSchema(def).map((f) => f.key)).toEqual(["utm"]);
  });

  it("keeps fields from branches unreachable from start", () => {
    // A half-finished edit shouldn't make already-collected values unrenderable.
    const def = flow({
      n1: { type: "question", field: "city", prompt: "עיר?", expect: "text", next: null },
      orphan: { type: "question", field: "legacy", prompt: "ישן?", expect: "text", next: null },
    });
    expect(deriveFieldSchema(def).map((f) => f.key)).toEqual(["city", "legacy"]);
  });

  it("ignores blank field names", () => {
    const def = flow({
      n1: { type: "question", field: "   ", prompt: "?", expect: "text", next: "n2" },
      n2: { type: "question", field: "ok", prompt: "טוב?", expect: "text", next: null },
    });
    expect(deriveFieldSchema(def).map((f) => f.key)).toEqual(["ok"]);
  });

  it("terminates on a cyclic flow", () => {
    const def = flow({
      n1: { type: "question", field: "a", prompt: "א?", expect: "text", next: "n2" },
      n2: { type: "question", field: "b", prompt: "ב?", expect: "text", next: "n1" },
    });
    expect(deriveFieldSchema(def).map((f) => f.key)).toEqual(["a", "b"]);
  });
});

describe("parseFieldSchema", () => {
  it("returns null for legacy/absent values so the caller can re-derive", () => {
    expect(parseFieldSchema(null)).toBeNull();
    expect(parseFieldSchema([])).toBeNull();
    expect(parseFieldSchema([{ key: "x" }])).toBeNull();
  });

  it("accepts a well-formed schema", () => {
    const ok = [{ key: "city", label: "עיר", expect: "text", order: 0 }];
    expect(parseFieldSchema(ok)).toHaveLength(1);
  });
});
