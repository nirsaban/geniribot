import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

/** Shared ioredis connection. Cast to ConnectionOptions when handed to BullMQ. */
export const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const bullConnection = connection as unknown as ConnectionOptions;

export const INBOUND_QUEUE = "wa-inbound";
export const OUTBOUND_QUEUE = "wa-outbound";
export const REMINDERS_QUEUE = "wa-reminders";

/** Inbound: a normalized WhatsApp message from the gateway to be processed. */
export interface InboundJob {
  organizationId: string;
  connectionId: string;
  from: string;
  /** Full sender JID (`…@s.whatsapp.net` / `…@lid`); optional on legacy jobs. */
  fromJid?: string;
  text: string;
  externalId: string;
}

/** Outbound: a message the gateway should send. */
export interface OutboundJob {
  organizationId: string;
  connectionId: string;
  to: string;
  /** Full destination JID; when absent the provider derives one from `to`. */
  toJid?: string;
  text: string;
}

export const outboundQueue = new Queue<OutboundJob>(OUTBOUND_QUEUE, {
  connection: bullConnection,
});

export const OUTBOUND_JOB = "send";

export interface ReminderJob {
  appointmentId: string;
  kind: "24h" | "1h";
}

/** Delayed reminder jobs (−24h / −1h before an appointment). */
export const remindersQueue = new Queue<ReminderJob>(REMINDERS_QUEUE, {
  connection: bullConnection,
});
