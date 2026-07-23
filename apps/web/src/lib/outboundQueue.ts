import "server-only";
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

/**
 * Producer for the shared `wa-outbound` queue (consumed by apps/gateway).
 * Lets web-side events — e.g. the Cal.com booking webhook — message a lead on
 * WhatsApp without going through the flow runtime. Mirrors `inboundQueue.ts`,
 * singleton across HMR/reloads.
 */
const g = globalThis as unknown as { __kesherOutbound?: Queue };

function makeQueue(): Queue {
  const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  }) as unknown as ConnectionOptions;
  return new Queue("wa-outbound", { connection });
}

export const outboundQueue: Queue = g.__kesherOutbound ?? (g.__kesherOutbound = makeQueue());

/** Job name the gateway consumer listens for (same as the worker's OUTBOUND_JOB). */
export const OUTBOUND_JOB = "send";

export interface OutboundJob {
  organizationId: string;
  connectionId: string;
  to: string;
  toJid?: string;
  text: string;
}
