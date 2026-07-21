import { childLogger } from "@kesher/core";
import { logActivity, prisma, type Prisma } from "@kesher/db";
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
import { addTag, assignOwner, notifyAgent } from "./agent-routing.js";
import { orgCalendar } from "./calendar.js";
import { formatSlot, offerSlots, slotMenu } from "./booking.js";
import {
  OUTBOUND_JOB,
  outboundQueue,
  remindersQueue,
  type InboundJob,
} from "./queues.js";

const HOUR = 3600 * 1000;

/**
 * Reply-rate ceiling per contact. A real conversation never needs this many
 * bot messages in a minute; an auto-responder exchange reaches it in seconds.
 */
const LOOP_WINDOW_MS = 60_000;
const LOOP_MAX_REPLIES = 8;

/** Quiet period required before a finished flow will restart itself. */
const RESTART_COOLDOWN_MS = 60_000;

const log = childLogger("worker:inbound");

/**
 * The runtime brain: take one inbound WhatsApp message, run it through the flow
 * engine, persist everything, and enqueue outbound replies. Pure logic lives in
 * @kesher/flow-engine; the booking pause (offer slots → capture choice → create
 * appointment → resume) is handled here because it needs DB I/O.
 */
/**
 * Is this sender one of our own WhatsApp connections?
 *
 * Two bots on this platform must never hold a conversation. It happens easily:
 * a business tests their bot from a phone that is itself paired as a connection
 * (their own, or another tenant's), and each bot's reply is the other's inbound.
 * Neither retries nor rate limits stop that cleanly — the messages parse fine,
 * so the flow advances, completes, restarts, and runs forever at whatever pace
 * the round trip allows.
 *
 * Checked platform-wide rather than per-organization, because the two ends are
 * usually in *different* organizations — that is exactly what makes it look
 * like ordinary lead traffic.
 *
 * Only CONNECTED connections count. A number that merely *has* a connection row
 * — one stuck at QR, or logged out — is not a bot, it is a person holding a
 * phone; silencing them is what this guard did to the very people most likely
 * to test their own bot. A real loop needs both ends live, so requiring
 * CONNECTED loses no protection.
 */
async function isPlatformNumber(from: string, fromJid?: string): Promise<boolean> {
  const candidates = [from];
  const jidUser = fromJid?.split("@")[0];
  if (jidUser && jidUser !== from) candidates.push(jidUser);

  const hit = await prisma.whatsAppConnection.findFirst({
    where: {
      status: "CONNECTED",
      OR: [
        { phoneNumber: { in: candidates } },
        { displayPhoneNumber: { in: candidates } },
      ],
    },
    select: { id: true, organizationId: true, phoneNumber: true },
  });
  if (hit) {
    log.warn(
      { from, fromJid, connectionId: hit.id, ownerOrg: hit.organizationId },
      "inbound from one of our own connections — not replying (bot-to-bot loop guard)",
    );
  }
  return Boolean(hit);
}

export async function processInbound(job: InboundJob): Promise<void> {
  const { organizationId, connectionId, from, fromJid, senderPn, text } = job;

  // Before anything else, and before any message is stored: a bot talking to a
  // bot is never a lead.
  if (await isPlatformNumber(from, fromJid)) return;

  // When a LID chat resolved to a real number, `from` is that number and the
  // LID is what any earlier contact was filed under.
  const legacyKey = senderPn && fromJid?.endsWith("@lid") ? fromJid.split("@")[0] : undefined;
  const contact = await resolveContact(organizationId, from, fromJid, legacyKey);

  let convo = await prisma.conversation.findFirst({
    where: { organizationId, contactId: contact.id, status: "ACTIVE" },
    orderBy: { lastMessageAt: "desc" },
  });

  // A keyword trigger acts like a command: it (re)starts its flow even if
  // another conversation is in progress. Otherwise an active conversation
  // continues its flow, and a brand-new one is matched by trigger.
  const keywordFlow = await selectKeywordFlow(organizationId, text);
  let flowRow: Flow | null = null;

  // A keyword restarts its flow even when that same flow is the one already
  // running. The previous `convo.flowId !== keywordFlow.id` guard meant sending
  // the keyword again did nothing — the most obvious thing a lead (or the
  // business testing their own bot) tries, and it answered with silence.
  if (keywordFlow) {
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
    // About to start a fresh run. If this contact only just finished one, stay
    // quiet: complete → restart → complete is a loop engine against any
    // auto-responder, and because a finished conversation is replaced rather
    // than reused, the evidence lives on the *previous* conversation rather
    // than on the state we are about to build.
    //
    // A returning lead clears a one-minute gap without noticing; a bot
    // answering in seconds never does.
    const previous = await prisma.conversation.findFirst({
      where: { organizationId, contactId: contact.id },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true, lastMessageAt: true },
    });
    if (previous && previous.lastMessageAt.getTime() > Date.now() - RESTART_COOLDOWN_MS) {
      log.warn(
        { contactId: contact.id, previousConversationId: previous.id },
        "flow finished moments ago — not restarting (loop guard)",
      );
      return;
    }

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
  // real scenario leads from plain inbound messages). `sourceFlowId` is the
  // stable half — `source` is a name and would break on rename, but the CRM
  // resolves the field schema through the id.
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      ...(contact.source ? {} : { source: flowRow.name, sourceFlowId: flowRow.id }),
      lastContactedAt: new Date(),
    },
  });

  await prisma.message.create({
    data: { conversationId: convo.id, direction: "IN", body: text },
  });

  const ctx: Ctx = {
    organizationId,
    connectionId,
    to: from,
    toJid: fromJid ?? contact.waJid ?? undefined,
    contactId: contact.id,
    ownerUserId: contact.ownerUserId,
    conversationId: convo.id,
    contactFields: (contact.fields as Record<string, unknown>) ?? {},
    contactName: contact.name,
  };
  // Loop guard, independent of the engine's retry cap.
  //
  // The retry cap only catches exchanges where our side fails to parse. Two
  // bots whose messages each parse cleanly would still ping-pong forever, so
  // this bounds how often we will reply to one contact at all. Crossing the
  // threshold pauses the conversation for a human rather than dropping it.
  const recentReplies = await prisma.message.count({
    where: {
      conversation: { contactId: contact.id },
      direction: "OUT",
      createdAt: { gte: new Date(Date.now() - LOOP_WINDOW_MS) },
    },
  });
  if (recentReplies >= LOOP_MAX_REPLIES) {
    await prisma.conversation.update({ where: { id: convo.id }, data: { status: "HANDOFF" } });
    log.warn(
      { contactId: contact.id, conversationId: convo.id, recentReplies },
      "reply rate limit hit — pausing conversation (possible bot-to-bot loop)",
    );
    return;
  }

  const prevState = convo.state as unknown as Partial<FlowState>;

  // Branch 1: paused for a booking slot choice.
  if (prevState.awaiting === "booking") {
    await handleBookingReply(flow, normalizeState(prevState), text, ctx);
    return;
  }

  // Branch 2: normal engine run.
  //
  // A conversation that already reached the end stores `currentNodeId: null`,
  // and the engine answers any further message on it with zero actions. Testing
  // only for `undefined` therefore treated a finished conversation as
  // resumable, so every lead who completed a flow and wrote again got silence
  // — permanently, since nothing ever moved the state on. Restart instead.
  const finished =
    !prevState ||
    prevState.currentNodeId === undefined ||
    prevState.currentNodeId === null ||
    prevState.status === "completed";

  const result = finished ? start(flow) : step(flow, normalizeState(prevState), { text });
  await applyAndPersist(flow, result, ctx);
}

/**
 * Find-or-create a contact, tolerant of the concurrent-message create race.
 *
 * `legacyKey` is the LID user part, passed when `phone` is a newly resolved
 * real number. Leads who wrote before we could resolve their number are stored
 * under the LID, and without this they would silently fork into a second
 * contact — losing their conversation history, notes and pipeline status at the
 * exact moment we finally learned who they are.
 */
async function resolveContact(
  organizationId: string,
  phone: string,
  waJid?: string,
  legacyKey?: string,
) {
  const where = { organizationId_phone: { organizationId, phone } };
  let existing = await prisma.contact.findUnique({ where });

  if (!existing && legacyKey && legacyKey !== phone) {
    const legacy = await prisma.contact.findUnique({
      where: { organizationId_phone: { organizationId, phone: legacyKey } },
    });
    if (legacy) {
      try {
        const migrated = await prisma.contact.update({
          where: { id: legacy.id },
          data: { phone, waJid },
        });
        log.info({ contactId: legacy.id, from: legacyKey, to: phone }, "lid contact resolved to phone");
        return migrated;
      } catch (err) {
        // A contact already exists under the real number (they also wrote from
        // a non-LID chat). Fall through and use that one; merging the two is a
        // destructive operation and not something to do implicitly.
        if ((err as { code?: string }).code !== "P2002") throw err;
        existing = await prisma.contact.findUnique({ where });
        log.warn(
          { legacyContactId: legacy.id, phone },
          "lid contact resolved to an existing phone contact; leaving both",
        );
      }
    }
  }

  if (existing) {
    // Backfill/refresh the routable JID — contacts created before this field
    // existed have none, and a sender can migrate to LID addressing later.
    if (waJid && existing.waJid !== waJid) {
      return await prisma.contact.update({ where: { id: existing.id }, data: { waJid } });
    }
    return existing;
  }
  try {
    const created = await prisma.contact.create({ data: { organizationId, phone, waJid } });
    await logActivity({
      organizationId,
      contactId: created.id,
      kind: "LEAD_CREATED",
      meta: { phone },
    });
    return created;
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
  /** Routable sender JID; see InboundMessage.fromJid. */
  toJid?: string;
  contactId: string;
  /** Owner at the time the run started. */
  ownerUserId?: string | null;
  /** Set when `assign_owner` ran earlier in this same step. */
  assignedUserId?: string;
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
    } else if (action.kind === "add_tag") {
      await addTag(ctx.organizationId, ctx.contactId, action.tag);
    } else if (action.kind === "assign_owner") {
      const userId = await assignOwner(ctx.organizationId, ctx.contactId, action.params);
      // Remember it so a notify_agent later in the same run reaches the person
      // who was just given the lead, without re-reading the row.
      if (userId) ctx.assignedUserId = userId;
    } else if (action.kind === "notify_agent") {
      await notifyAgent({
        organizationId: ctx.organizationId,
        contactId: ctx.contactId,
        connectionId: ctx.connectionId,
        userId: ctx.assignedUserId ?? ctx.ownerUserId ?? null,
        pendingFields: savedFields,
        enqueueOutbound: async (to, text) => {
          await outboundQueue.add(OUTBOUND_JOB, {
            organizationId: ctx.organizationId,
            connectionId: ctx.connectionId,
            to,
            text,
          });
        },
      });
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
  await logActivity({
    organizationId: ctx.organizationId,
    contactId: ctx.contactId,
    kind: "APPOINTMENT_BOOKED",
    toValue: appt.startsAt.toISOString(),
    meta: { appointmentId: appt.id },
  });

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
    toJid: ctx.toJid,
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

  // The engine's own view of the run wins over `awaitingInput`. A finished run
  // that still reported awaitingInput left the row ACTIVE while its state said
  // "completed" — which is how a dead conversation kept being picked up as the
  // live one instead of a fresh conversation being started.
  const status =
    state.status === "handoff"
      ? "HANDOFF"
      : state.status === "completed" || state.currentNodeId === null
        ? "COMPLETED"
        : awaitingInput
          ? "ACTIVE"
          : "COMPLETED";
  await prisma.conversation.update({
    where: { id: ctx.conversationId },
    data: {
      state: state as unknown as Prisma.InputJsonValue,
      currentNodeId: state.currentNodeId,
      status,
      lastMessageAt: new Date(),
    },
  });

  // The bot finishing its questions is the moment a human should pick the lead
  // up, so it belongs on the timeline.
  if (status !== "ACTIVE") {
    await logActivity({
      organizationId: ctx.organizationId,
      contactId: ctx.contactId,
      kind: "CONVERSATION_COMPLETED",
      toValue: status,
      meta: { conversationId: ctx.conversationId },
    });
  }
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
      description: "נקבע דרך GeniriBot",
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
