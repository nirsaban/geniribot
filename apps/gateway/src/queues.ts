import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

/** Queue names — must match apps/worker/src/queues.ts. */
export const INBOUND_QUEUE = "wa-inbound";
export const OUTBOUND_QUEUE = "wa-outbound";
export const INBOUND_JOB = "inbound";

export const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
export const bullConnection = connection as unknown as ConnectionOptions;

export interface InboundJob {
  organizationId: string;
  connectionId: string;
  from: string;
  text: string;
  externalId: string;
}

export interface OutboundJob {
  organizationId: string;
  connectionId: string;
  to: string;
  text: string;
}

/** Gateway publishes normalized inbound messages here for the worker. */
export const inboundQueue = new Queue<InboundJob>(INBOUND_QUEUE, {
  connection: bullConnection,
});
