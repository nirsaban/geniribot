import { childLogger } from "@kesher/core";
import { prisma, type Prisma } from "@kesher/db";
import {
  FlowDefinition,
  matchesTrigger,
  resumeBooking,
  start,
  step,
  triggerSpecificity,
  type FlowState,
  type StepResult,
} from "@kesher/flow-engine";
import type { Flow } from "@kesher/db";
import { orgCalendar } from "./calendar.js";
import { formatSlot, offerSlots, slotMenu } from "./booking.js";
import {
  OUTBOUND_JOB,
  outboundQueue,
  remindersQueue,
  type InboundJob,
} from "./queues.js";

const HOUR = 3600 * 1000;

const log = childLogger("worker:inbound");

/**
 * The runtime brain: take one inbound WhatsApp message, run it through the flow
 * engine, persist everything, and enqueue outbound replies. Pure logic lives in
 * @kesher/flow-engine; the booking pause (offer slots → capture choice → create
 * appointment → resume) is handled here because it needs DB I/O.
 */
export async function processInbound(job: InboundJob): Promise<void> {
  const { organizationId, connectionId, from, text } = job;

  const contact = await resolveContact(organizationId, from);

  let convo = await prisma.conversation.findFirst({
    where: { organizationId, contactId: contact.id, status: "ACTIVE" },
    orderBy: { lastMessageAt: "desc" },
  });

  // A keyword trigger acts like a command: it (re)starts its flow even if
  // another conversation is in progress. Otherwise an active conversation
  // continues its flow, and a brand-new one is matched by trigger.
  const keywordFlow = await selectKeywordFlow(organizationId, text);
  let flowRow: Flow | null = null;

  if (keywordFlow && (!convo || convo.flowId !== keywordFlow.id)) {
    if (convo) {
      await prisma.conversation.update({ where: { id: convo.id }, data: { status: "ABANDONED" } });
      convo = null;
    }
    flowRow = keywordFlow;
  } else if (convo?.flowId) {
    flowRow = await prisma.flow.findUnique({ where: { id: convo.flowId } });
  }
  if (!flowRow) {
    flowRow = await selectFlowByTrigger(organizationId, connectionId, text);
  }
  if (!flowRow) {
    const activeCount = await prisma.flow.count({ where: { organizationId, isActive: true } });
    log.warn(
      { organizationId, connectionId, activeFlows: activeCount },
      activeCount === 0 ? "no ACTIVE flow — activate a flow in the dashboard" : "no matching flow; ignoring message",
    );
    return;
  }
  const flow = FlowDefinition.parse(flowRow.definition);

  if (!convo) {
    convo = await prisma.conversation.create({
      data: {
        organizationId,
        contactId: contact.id,
        connectionId,
        flowId: flowRow.id,
        state: {},
        status: "ACTIVE",
      },
    });
  }

  // Mark the lead's source = the scenario that first engaged them (distinguishes
  // real scenario leads from plain inbound messages).
  if (!contact.source) {
    await prisma.contact.update({ where: { id: contact.id }, data: { source: flowRow.name } });
  }

  await prisma.message.create({
    data: { conversationId: convo.id, direction: "IN", body: text },
  });

  const ctx: Ctx = {
    organizationId,
    connectionId,
    to: from,
    contactId: contact.id,
    conversationId: convo.id,
    contactFields: (contact.fields as Record<string, unknown>) ?? {},
    contactName: contact.name,
  };
  const prevState = convo.state as unknown as Partial<FlowState>;

  // Branch 1: paused for a booking slot choice.
  if (prevState.awaiting === "booking") {
    await handleBookingReply(flow, normalizeState(prevState), text, ctx);
    return;
  }

  // Branch 2: normal engine run.
  const isFresh = !prevState || prevState.currentNodeId === undefined;
  const result = isFresh ? start(flow) : step(flow, normalizeState(prevState), { text });
  await applyAndPersist(flow, result, ctx);
}

/** Find-or-create a contact, tolerant of the concurrent-message create race. */
async function resolveContact(organizationId: string, phone: string) {
  const where = { organizationId_phone: { organizationId, phone } };
  const existing = await prisma.contact.findUnique({ where });
  if (existing) return existing;
  try {
    return await prisma.contact.create({ data: { organizationId, phone } });
  } catch (err) {
    // Another message for the same new contact won the create race.
    if ((err as { code?: string }).code === "P2002") {
      const c = await prisma.contact.findUnique({ where });
      if (c) return c;
    }
    throw err;
  }
}

/** An ACTIVE flow whose keyword trigger matches this message (most specific). */
async function selectKeywordFlow(organizationId: string, text: string): Promise<Flow | null> {
  const flows = await prisma.flow.findMany({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  for (const f of flows) {
    const parsed = FlowDefinition.safeParse(f.definition);
    if (!parsed.success) continue;
    const t = parsed.data.trigger;
    if (triggerSpecificity(t) === 1 && matchesTrigger(t, text)) return f;
  }
  return null;
}

/**
 * Choose which active flow an inbound message starts, by matching triggers:
 * a keyword trigger that matches wins; otherwise the connection's default flow;
 * otherwise a catch-all ("any") flow. Returns null if the org has no flows.
 */
async function selectFlowByTrigger(
  organizationId: string,
  connectionId: string,
  text: string,
): Promise<Flow | null> {
  const flows = await prisma.flow.findMany({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (flows.length === 0) return null;

  const parsed = flows
    .map((f) => ({ f, def: FlowDefinition.safeParse(f.definition) }))
    .filter((p) => p.def.success)
    .map((p) => ({ f: p.f, trigger: p.def.data!.trigger }));

  // 1) keyword trigger that matches the message (most specific)
  const kw = parsed.find(
    (p) => triggerSpecificity(p.trigger) === 1 && matchesTrigger(p.trigger, text),
  );
  if (kw) return kw.f;

  // 2) the connection's configured default flow, if any
  const conn = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } });
  if (conn?.defaultFlowId) {
    const d = parsed.find((p) => p.f.id === conn.defaultFlowId);
    if (d) return d.f;
  }

  // 3) a catch-all ("any") flow, else the first active flow
  const anyFlow = parsed.find((p) => triggerSpecificity(p.trigger) === 0);
  return (anyFlow ?? parsed[0])?.f ?? null;
}

interface Ctx {
  organizationId: string;
  connectionId: string;
  to: string;
  contactId: string;
  conversationId: string;
  contactFields: Record<string, unknown>;
  contactName: string | null;
}

/** Apply engine actions (incl. the booking offer) and persist final state. */
async function applyAndPersist(flow: FlowDefinition, result: StepResult, ctx: Ctx): Promise<void> {
  const savedFields: Record<string, unknown> = {};
  let finalState: FlowState = result.state;

  for (const action of result.actions) {
    if (action.kind === "send_message") {
      await sendOut(action.text, ctx);
    } else if (action.kind === "save_field") {
      savedFields[action.field] = action.value;
    } else if (action.kind === "book_appointment") {
      // If the tenant uses their own Cal.com link, send it and continue (no
      // in-chat slot picking). Otherwise offer available times in-chat.
      const org = await prisma.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { calcomLink: true },
      });
      if (org?.calcomLink) {
        await sendOut(`אשמח לקבוע פגישה! קבע/י מועד שנוח לך כאן 👇\n${org.calcomLink}`, ctx);
        const resumed = resumeBooking(flow, finalState);
        for (const a of resumed.actions) if (a.kind === "send_message") await sendOut(a.text, ctx);
        finalState = resumed.state;
        continue;
      }
      const slots = await offerSlots(ctx.organizationId);
      if (slots.length > 0) {
        await sendOut(slotMenu(slots), ctx);
        finalState = {
          ...finalState,
          booking: {
            offered: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
          },
        };
      } else {
        // No availability configured → skip booking, continue the flow.
        await sendOut("ניצור איתך קשר בהקדם לתיאום מועד 🙏", ctx);
        const resumed = resumeBooking(flow, finalState);
        for (const a of resumed.actions) if (a.kind === "send_message") await sendOut(a.text, ctx);
        finalState = resumed.state;
      }
    } else {
      log.info({ kind: action.kind, conversationId: ctx.conversationId }, "action (later phase)");
    }
  }

  await persist(ctx, savedFields, finalState, result.awaitingInput);
}

/** Handle the lead's reply while paused on the slot menu. */
async function handleBookingReply(
  flow: FlowDefinition,
  state: FlowState,
  text: string,
  ctx: Ctx,
): Promise<void> {
  const offered = state.booking?.offered ?? [];
  const pick = Number(text.trim());

  if (!Number.isInteger(pick) || pick < 1 || pick > offered.length) {
    // Re-prompt with the same menu.
    const slots = offered.map((o) => ({ start: new Date(o.start), end: new Date(o.end) }));
    await sendOut("בחר/י מספר מהרשימה 🙏\n" + slotMenu(slots), ctx);
    return; // stay paused; state unchanged
  }

  const slot = offered[pick - 1]!;
  const appt = await prisma.appointment.create({
    data: {
      organizationId: ctx.organizationId,
      contactId: ctx.contactId,
      startsAt: new Date(slot.start),
      endsAt: new Date(slot.end),
      status: "BOOKED",
    },
  });
  await sendOut(`מצוין! נקבעה שיחה ל־${formatSlot(new Date(slot.start))} ✅`, ctx);

  // Google Calendar event + WhatsApp reminders (both optional / best-effort).
  await syncCalendarEvent(appt.id, ctx);
  await scheduleReminders(appt.id, appt.startsAt);

  // Resume the flow after the booking (e.g. the closing message).
  const resumed = resumeBooking(flow, state);
  const savedFields: Record<string, unknown> = {};
  for (const a of resumed.actions) {
    if (a.kind === "send_message") await sendOut(a.text, ctx);
    else if (a.kind === "save_field") savedFields[a.field] = a.value;
  }
  await persist(ctx, savedFields, resumed.state, resumed.awaitingInput);
}

async function sendOut(text: string, ctx: Ctx): Promise<void> {
  await prisma.message.create({
    data: { conversationId: ctx.conversationId, direction: "OUT", body: text },
  });
  await outboundQueue.add(OUTBOUND_JOB, {
    organizationId: ctx.organizationId,
    connectionId: ctx.connectionId,
    to: ctx.to,
    text,
  });
}

async function persist(
  ctx: Ctx,
  savedFields: Record<string, unknown>,
  state: FlowState,
  awaitingInput: boolean,
): Promise<void> {
  if (Object.keys(savedFields).length > 0) {
    const merged = { ...ctx.contactFields, ...savedFields };
    await prisma.contact.update({
      where: { id: ctx.contactId },
      data: {
        fields: merged as Prisma.InputJsonValue,
        name: (merged.name as string | undefined) ?? ctx.contactName,
      },
    });
  }

  await prisma.conversation.update({
    where: { id: ctx.conversationId },
    data: {
      state: state as unknown as Prisma.InputJsonValue,
      currentNodeId: state.currentNodeId,
      status: awaitingInput ? "ACTIVE" : state.status === "handoff" ? "HANDOFF" : "COMPLETED",
      lastMessageAt: new Date(),
    },
  });
}

function normalizeState(s: Partial<FlowState>): FlowState {
  return {
    currentNodeId: s.currentNodeId ?? null,
    answers: s.answers ?? {},
    retries: s.retries ?? 0,
    status: s.status ?? "active",
    awaiting: s.awaiting,
    resumeNodeId: s.resumeNodeId,
    booking: s.booking,
  };
}

/** Best-effort: mirror the appointment into the tenant's Google Calendar. */
async function syncCalendarEvent(appointmentId: string, ctx: Ctx): Promise<void> {
  const cal = await orgCalendar(ctx.organizationId);
  if (!cal) return;
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appt) return;
  try {
    const { id } = await cal.createEvent({
      summary: `שיחת מכירה — ${ctx.contactName ?? ctx.to}`,
      description: "נקבע דרך Kesher",
      startISO: appt.startsAt.toISOString(),
      endISO: appt.endsAt.toISOString(),
      timezone: "Asia/Jerusalem",
    });
    await prisma.appointment.update({ where: { id: appt.id }, data: { googleEventId: id } });
  } catch (err) {
    log.warn({ err: (err as Error).message, appointmentId }, "google createEvent failed");
  }
}

/** Schedule −24h / −1h WhatsApp reminders (skips windows already passed). */
async function scheduleReminders(appointmentId: string, startsAt: Date): Promise<void> {
  const now = Date.now();
  const plan: Array<{ kind: "24h" | "1h"; before: number }> = [
    { kind: "24h", before: 24 * HOUR },
    { kind: "1h", before: HOUR },
  ];
  for (const p of plan) {
    const delay = startsAt.getTime() - p.before - now;
    if (delay <= 0) continue;
    await remindersQueue.add(
      "remind",
      { appointmentId, kind: p.kind },
      { delay, jobId: `${appointmentId}_${p.kind}`, removeOnComplete: true },
    );
  }
}
