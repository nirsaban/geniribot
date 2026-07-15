import { describe, expect, it } from "vitest";
import { evalCondition, resumeBooking, start, step } from "./step.js";
import { FlowDefinition, matchesTrigger, triggerSpecificity } from "./types.js";

const flow = FlowDefinition.parse({
  start: "n1",
  nodes: {
    n1: { type: "message", text: "שלום!", next: "n2" },
    n2: { type: "question", field: "name", prompt: "מה השם שלך?", expect: "text", next: "n3" },
    n3: {
      type: "question",
      field: "service",
      prompt: "במה נעזור?",
      expect: "choice",
      choices: ["מכירה", "תמיכה"],
      next: "n4",
    },
    n4: { type: "condition", when: "answers.service == 'מכירה'", then: "n5", else: "n6" },
    n5: { type: "action", action: "book_appointment", next: "n7" },
    n6: { type: "action", action: "notify_agent", next: "n7" },
    n7: { type: "message", text: "תודה!", next: null },
  },
});

describe("flow-engine happy path", () => {
  it("greets then waits for the first question", () => {
    const r = start(flow);
    expect(r.awaitingInput).toBe(true);
    expect(r.state.currentNodeId).toBe("n2");
    expect(r.actions).toEqual([
      { kind: "send_message", text: "שלום!" },
      { kind: "send_message", text: "מה השם שלך?" },
    ]);
  });

  it("saves an answer and advances to the next question", () => {
    const r1 = start(flow);
    const r2 = step(flow, r1.state, { text: "  דנה  " });
    expect(r2.state.answers.name).toBe("דנה");
    expect(r2.awaitingInput).toBe(true);
    expect(r2.state.currentNodeId).toBe("n3");
    expect(r2.actions).toContainEqual({ kind: "save_field", field: "name", value: "דנה" });
  });

  it("routes 'מכירה' to book_appointment and pauses for a slot choice", () => {
    let s = start(flow).state;
    s = step(flow, s, { text: "דנה" }).state;
    const r = step(flow, s, { text: "1" }); // choice index 1 => מכירה
    expect(r.state.answers.service).toBe("מכירה");
    expect(r.actions).toContainEqual({ kind: "book_appointment", params: { resumeNodeId: "n7" } });
    // pauses waiting for the lead to pick a slot; does NOT reach "תודה!" yet
    expect(r.awaitingInput).toBe(true);
    expect(r.state.awaiting).toBe("booking");
    expect(r.state.resumeNodeId).toBe("n7");
    expect(r.actions).not.toContainEqual({ kind: "send_message", text: "תודה!" });
  });

  it("resumeBooking continues the flow to completion after booking", () => {
    let s = start(flow).state;
    s = step(flow, s, { text: "דנה" }).state;
    s = step(flow, s, { text: "1" }).state; // now awaiting booking
    const r = resumeBooking(flow, s);
    expect(r.actions).toContainEqual({ kind: "send_message", text: "תודה!" });
    expect(r.awaitingInput).toBe(false);
    expect(r.state.status).toBe("completed");
    expect(r.state.awaiting).toBeUndefined();
  });

  it("routes 'תמיכה' to notify_agent", () => {
    let s = start(flow).state;
    s = step(flow, s, { text: "דנה" }).state;
    const r = step(flow, s, { text: "תמיכה" });
    expect(r.actions).toContainEqual({ kind: "notify_agent", params: undefined });
  });
});

describe("validation & retries", () => {
  it("re-prompts on an unknown choice without advancing", () => {
    let s = start(flow).state;
    s = step(flow, s, { text: "דנה" }).state;
    const r = step(flow, s, { text: "משהו אחר" });
    expect(r.awaitingInput).toBe(true);
    expect(r.state.currentNodeId).toBe("n3");
    expect(r.state.retries).toBe(1);
    expect(r.state.answers.service).toBeUndefined();
  });
});

describe("triggers", () => {
  it("matches any-trigger on any text", () => {
    expect(matchesTrigger(undefined, "hi")).toBe(true);
    expect(matchesTrigger({ type: "any" }, "whatever")).toBe(true);
  });
  it("matches keyword triggers case-insensitively by substring", () => {
    const t = { type: "keyword" as const, keywords: ["מחיר", "פגישה"] };
    expect(matchesTrigger(t, "כמה המחיר?")).toBe(true);
    expect(matchesTrigger(t, "שלום")).toBe(false);
  });
  it("ranks keyword triggers above catch-all", () => {
    expect(triggerSpecificity({ type: "keyword", keywords: ["x"] })).toBe(1);
    expect(triggerSpecificity({ type: "any" })).toBe(0);
    expect(triggerSpecificity(undefined)).toBe(0);
  });
});

describe("evalCondition", () => {
  it("compares strings and numbers", () => {
    expect(evalCondition("answers.service == 'מכירה'", { service: "מכירה" })).toBe(true);
    expect(evalCondition("answers.budget > 1000", { budget: 5000 })).toBe(true);
    expect(evalCondition("answers.budget > 1000", { budget: 10 })).toBe(false);
    expect(evalCondition("answers.x != 'y'", { x: "z" })).toBe(true);
  });
});
