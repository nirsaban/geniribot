import { describe, expect, it } from "vitest";
import { evalCondition, MAX_RETRIES, renderTemplate, resumeBooking, resumeDelay, start, step } from "./step.js";
import { FlowDefinition, initialState, matchesTrigger, triggerSpecificity, type FlowState } from "./types.js";

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

describe("choice questions show their options", () => {
  const ask = (state: FlowState) =>
    step(flow, state, { text: "רן" }).actions.flatMap((a) =>
      a.kind === "send_message" ? [a.text] : [],
    );

  it("sends a numbered menu with the prompt", () => {
    const sent = ask({ ...initialState(flow), currentNodeId: "n2" });
    expect(sent).toEqual(["במה נעזור?\n1. מכירה\n2. תמיכה"]);
  });

  it("lets the lead answer with the number it just showed", () => {
    let state: FlowState = { ...initialState(flow), currentNodeId: "n3" };
    const r = step(flow, state, { text: "2" });
    expect(r.actions).toContainEqual({ kind: "save_field", field: "service", value: "תמיכה" });
    expect(r.state.retries).toBe(0);
  });

  it("leaves non-choice questions untouched", () => {
    const r = start(flow);
    expect(r.actions).toContainEqual({ kind: "send_message", text: "מה השם שלך?" });
  });

  it("omits the menu when a choice node has no options", () => {
    const bare = FlowDefinition.parse({
      start: "q",
      nodes: { q: { type: "question", field: "x", prompt: "מה?", expect: "choice", next: null } },
    });
    expect(start(bare).actions).toContainEqual({ kind: "send_message", text: "מה?" });
  });
});

describe("retry cap", () => {
  const choiceFlow = FlowDefinition.parse({
    start: "q",
    nodes: {
      q: { type: "question", field: "ok", prompt: "כן או לא?", expect: "choice", choices: ["כן", "לא"], next: null },
    },
  });

  it("re-prompts while under the cap", () => {
    let state = initialState(choiceFlow);
    state = { ...state, currentNodeId: "q" };
    const r = step(choiceFlow, state, { text: "משהו אחר" });
    expect(r.actions[0]).toMatchObject({ kind: "send_message" });
    expect(r.state.retries).toBe(1);
    expect(r.awaitingInput).toBe(true);
  });

  it("hands off instead of re-prompting forever", () => {
    // The production loop: another bot's prompt arrives, never parses, and both
    // sides re-prompt each other indefinitely.
    let state: FlowState = { ...initialState(choiceFlow), currentNodeId: "q" };
    const sent: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = step(choiceFlow, state, { text: "בחירה לא מוכרת, נסה שוב (מכירה / תמיכה / אחר)" });
      state = r.state;
      for (const a of r.actions) if (a.kind === "send_message") sent.push(a.text);
      if (state.status !== "active") break;
    }
    expect(state.status).toBe("handoff");
    // Bounded: MAX_RETRIES prompts, then it stops replying.
    expect(sent).toHaveLength(MAX_RETRIES);
  });

  it("stays silent once handed off, so the exchange terminates", () => {
    const handed: FlowState = {
      ...initialState(choiceFlow),
      currentNodeId: "q",
      status: "handoff",
    };
    const r = step(choiceFlow, handed, { text: "עוד הודעה" });
    expect(r.actions).toEqual([]);
  });

  it("keeps currentNodeId on handoff so the runtime does not restart it", () => {
    let state: FlowState = { ...initialState(choiceFlow), currentNodeId: "q", retries: MAX_RETRIES };
    state = step(choiceFlow, state, { text: "לא תקין" }).state;
    expect(state.status).toBe("handoff");
    expect(state.currentNodeId).toBe("q");
  });
});

describe("elastic flow extensions (delay / branches / templates)", () => {
  const dripFlow = FlowDefinition.parse({
    start: "n1",
    nodes: {
      n1: { type: "question", field: "name", prompt: "מה השם?", expect: "text", next: "n2" },
      n2: { type: "message", text: "נעים מאוד {name}!", next: "n3" },
      n3: { type: "delay", minutes: 60, next: "n4" },
      n4: { type: "message", text: "עדיין רלוונטי, {name}?", next: null },
    },
  });

  it("pauses on a delay node and emits schedule_delay", () => {
    const r1 = start(dripFlow);
    const r2 = step(dripFlow, r1.state, { text: "דנה" });
    expect(r2.state.awaiting).toBe("delay");
    expect(r2.state.resumeNodeId).toBe("n4");
    expect(r2.awaitingInput).toBe(false);
    expect(r2.actions).toContainEqual({ kind: "schedule_delay", minutes: 60, resumeNodeId: "n4" });
    // the interpolated message went out before the pause
    expect(r2.actions).toContainEqual({ kind: "send_message", text: "נעים מאוד דנה!" });
  });

  it("resumeDelay continues from the paused node's next with templates filled", () => {
    const r1 = start(dripFlow);
    const r2 = step(dripFlow, r1.state, { text: "דנה" });
    const r3 = resumeDelay(dripFlow, r2.state);
    expect(r3.state.status).toBe("completed");
    expect(r3.actions).toContainEqual({ kind: "send_message", text: "עדיין רלוונטי, דנה?" });
  });

  it("resumeDelay is a no-op when the conversation is not waiting on a delay", () => {
    const r1 = start(dripFlow);
    const r3 = resumeDelay(dripFlow, r1.state);
    expect(r3.actions).toEqual([]);
    expect(r3.state).toBe(r1.state);
  });

  it("a reply during a delay cuts the wait short", () => {
    const r1 = start(dripFlow);
    const r2 = step(dripFlow, r1.state, { text: "דנה" });
    const r3 = step(dripFlow, r2.state, { text: "כן עדיין פה" });
    expect(r3.state.awaiting).toBeUndefined();
    expect(r3.actions).toContainEqual({ kind: "send_message", text: "עדיין רלוונטי, דנה?" });
  });

  const branchFlow = FlowDefinition.parse({
    start: "q",
    nodes: {
      q: {
        type: "question",
        field: "topic",
        prompt: "במה מדובר?",
        expect: "choice",
        choices: ["מכירות", "תמיכה", "אחר"],
        branches: { מכירות: "sales", תמיכה: "support" },
        next: "other",
      },
      sales: { type: "message", text: "מעביר למכירות", next: null },
      support: { type: "message", text: "מעביר לתמיכה", next: null },
      other: { type: "message", text: "נחזור אליך", next: null },
    },
  });

  it("routes a choice answer through its declared branch", () => {
    const r1 = start(branchFlow);
    const r2 = step(branchFlow, r1.state, { text: "2" });
    expect(r2.actions).toContainEqual({ kind: "send_message", text: "מעביר לתמיכה" });
  });

  it("falls through to next when the choice has no branch", () => {
    const r1 = start(branchFlow);
    const r2 = step(branchFlow, r1.state, { text: "אחר" });
    expect(r2.actions).toContainEqual({ kind: "send_message", text: "נחזור אליך" });
  });

  it("renderTemplate fills known keys and leaves unknown ones visible", () => {
    expect(renderTemplate("שלום {name}, {missing}!", { name: "דנה" })).toBe("שלום דנה, {missing}!");
  });
});
