import { childLogger } from "@kesher/core";
import { prisma, type Prisma } from "@kesher/db";
import {
  FlowDefinition,
  start,
  step,
  type EngineAction,
  type FlowState,
} from "@kesher/flow-engine";
import { OUTBOUND_JOB, outboundQueue, type InboundJob } from "./queues.js";

const log = childLogger("worker:inbound");

/**
 * The runtime brain: take one inbound WhatsApp message, run it through the flow
 * engine, persist everything, and enqueue outbound replies. Pure logic lives in
 * @kesher/flow-engine; this function does only the I/O around it.
 */
export async function processInbound(job: InboundJob): Promise<void> {
  const { organizationId, connectionId, from, text } = job;

  // 1. Resolve or create the contact (tenant-scoped by org + phone).
  const contact = await prisma.contact.upsert({
    where: { organizationId_phone: { organizationId, phone: from } },
    update: {},
    create: { organizationId, phone: from },
  });

  // 2. Pick the flow: connection default, else the org's active flow.
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { id: connectionId },
  });
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

  // 3. Load or open the conversation.
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

  // Record the inbound message.
  await prisma.message.create({
    data: { conversationId: convo.id, direction: "IN", body: text },
  });

  // 4. Run the engine. Fresh conversation → start() (greet + first question);
  //    otherwise → step() with the user's reply.
  const prevState = convo.state as unknown as Partial<FlowState>;
  const isFresh = !prevState || prevState.currentNodeId === undefined;
  const result = isFresh
    ? start(flow)
    : step(flow, normalizeState(prevState), { text });

  // 5. Apply side effects.
  const savedFields: Record<string, unknown> = {};
  for (const action of result.actions) {
    await applyAction(action, {
      organizationId,
      connectionId,
      to: from,
      conversationId: convo.id,
      savedFields,
    });
  }

  // 6. Persist contact fields + conversation state.
  if (Object.keys(savedFields).length > 0) {
    const merged = {
      ...(contact.fields as Record<string, unknown>),
      ...savedFields,
    };
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        fields: merged as Prisma.InputJsonValue,
        name: (merged.name as string | undefined) ?? contact.name,
      },
    });
  }

  await prisma.conversation.update({
    where: { id: convo.id },
    data: {
      state: result.state as unknown as Prisma.InputJsonValue,
      currentNodeId: result.state.currentNodeId,
      status: result.awaitingInput
        ? "ACTIVE"
        : result.state.status === "handoff"
          ? "HANDOFF"
          : "COMPLETED",
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
  };
}

interface ActionCtx {
  organizationId: string;
  connectionId: string;
  to: string;
  conversationId: string;
  savedFields: Record<string, unknown>;
}

async function applyAction(action: EngineAction, ctx: ActionCtx): Promise<void> {
  switch (action.kind) {
    case "send_message":
      await prisma.message.create({
        data: { conversationId: ctx.conversationId, direction: "OUT", body: action.text },
      });
      await outboundQueue.add(OUTBOUND_JOB, {
        organizationId: ctx.organizationId,
        connectionId: ctx.connectionId,
        to: ctx.to,
        text: action.text,
      });
      break;
    case "save_field":
      ctx.savedFields[action.field] = action.value;
      break;
    case "book_appointment":
      // Phase 4: offer slots + create Appointment. For now, log intent.
      log.info({ conversationId: ctx.conversationId }, "book_appointment (Phase 4)");
      break;
    case "notify_agent":
    case "assign_owner":
    case "add_tag":
    case "webhook":
    case "handoff_to_human":
    case "end":
      log.info({ kind: action.kind, conversationId: ctx.conversationId }, "action (later phase)");
      break;
  }
}
