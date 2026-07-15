import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

/** Shared ioredis connection. Cast to ConnectionOptions when handed to BullMQ. */
export const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const bullConnection = connection as unknown as ConnectionOptions;

export const INBOUND_QUEUE = "wa-inbound";
export const OUTBOUND_QUEUE = "wa-outbound";

/** Inbound: a normalized WhatsApp message from the gateway to be processed. */
export interface InboundJob {
  organizationId: string;
  connectionId: string;
  from: string;
  text: string;
  externalId: string;
}

/** Outbound: a message the gateway should send. */
export interface OutboundJob {
  organizationId: string;
  connectionId: string;
  to: string;
  text: string;
}

export const outboundQueue = new Queue<OutboundJob>(OUTBOUND_QUEUE, {
  connection: bullConnection,
});

export const OUTBOUND_JOB = "send";
