import "server-only";
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

/**
 * Producer for the shared `wa-inbound` queue (consumed by apps/worker). Used by
 * the public WhatsApp Cloud API webhook to hand messages to the flow runtime —
 * the same queue Baileys inbound flows through. Singleton across HMR/reloads.
 */
const g = globalThis as unknown as { __kesherInbound?: Queue };

function makeQueue(): Queue {
  const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  }) as unknown as ConnectionOptions;
  return new Queue("wa-inbound", { connection });
}

export const inboundQueue: Queue = g.__kesherInbound ?? (g.__kesherInbound = makeQueue());

export interface InboundJob {
  organizationId: string;
  connectionId: string;
  from: string;
  text: string;
  externalId: string;
}
