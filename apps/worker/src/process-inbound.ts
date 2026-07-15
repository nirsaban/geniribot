import { childLogger } from "@kesher/core";
import { prisma, type Prisma } from "@kesher/db";
import {
  FlowDefinition,
  resumeBooking,
  start,
  step,
  type FlowState,
  type StepResult,
} from "@kesher/flow-engine";
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

  const contact = await prisma.contact.upsert({
    where: { organizationId_phone: { organizationId, phone: from } },
    update: {},
    create: { organizationId, phone: from },
  });

  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } });
  const flowRow = connection?.defaultFlowId
    ? await prisma.flow.findUnique({ where: { id: connection.defaultFlowId } })
    : await prisma.flow.findFirst({
        where: { organizationId, isActive: true },
        orderBy: { createdAt: "asc" },
      });
  if (!flowRow) {
    log.warn({ organizationId, connectionId }, "no active flow; ignoring message");
    return;
  }
  const flow = FlowDefinition.parse(flowRow.definition);

  let convo = await prisma.conversation.findFirst({
    where: { organizationId, contactId: contact.id, status: "ACTIVE" },
    orderBy: { lastMessageAt: "desc" },
  });
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
