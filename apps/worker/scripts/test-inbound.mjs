#!/usr/bin/env node
/**
 * Manual trigger for the WhatsApp pipeline — inject a synthetic inbound message
 * straight onto wa-inbound, exactly as the gateway would after a real message.
 *
 *   node apps/worker/scripts/test-inbound.mjs "<from-phone>" "<text>" [connectionId]
 *
 * This bypasses WhatsApp entirely, so it isolates the half of the pipeline you
 * can't otherwise see: queue -> worker -> flow engine -> outbound. If the reply
 * arrives on your phone, the flow is fine and the fault is upstream (Baileys
 * link / Cloud API webhook). If nothing happens, watch data/worker.log.
 *
 * Defaults to the org's only CONNECTED Baileys connection when no id is given.
 */
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@kesher/db";

const [, , fromArg, textArg, connArg] = process.argv;
if (!fromArg || !textArg) {
  console.error(
    'usage: node apps/worker/scripts/test-inbound.mjs "<from-phone>" "<text>" [connectionId]',
  );
  process.exit(1);
}
// Accepts either a bare number (972501234567) or a full JID
// (14396898152593@lid), so the LID reply path can be exercised too — a
// digits-only `from` is NOT routable back to a LID sender.
const fromJid = fromArg.includes("@")
  ? fromArg
  : `${fromArg.replace(/\D/g, "")}@s.whatsapp.net`;
// Matches the gateway's normalized `from`: the JID's user part.
const from = fromJid.split("@")[0];


const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Refuse to enqueue against a hijacked/replica Redis — the write would be
// silently lost and the test would look like a flow bug.
const role = (await redis.info("replication")).match(/^role:(\w+)/m)?.[1];
if (role !== "master") {
  console.error(`redis role is "${role}", not master — writes will fail. Aborting.`);
  process.exit(2);
}

const conn = connArg
  ? await prisma.whatsAppConnection.findUnique({ where: { id: connArg } })
  : await prisma.whatsAppConnection.findFirst({
      where: { status: "CONNECTED" },
      orderBy: { updatedAt: "desc" },
    });

if (!conn) {
  console.error("no CONNECTED connection found — pass a connectionId explicitly");
  process.exit(1);
}

const queue = new Queue("wa-inbound", { connection: redis });
const externalId = `manual-${Date.now()}`;
const job = {
  organizationId: conn.organizationId,
  connectionId: conn.id,
  from,
  fromJid,
  text: textArg,
  externalId,
};

await queue.add("inbound", job, { jobId: `${conn.id}_${externalId}` });

console.log("enqueued ->", JSON.stringify(job, null, 2));
console.log(`\nconnection: ${conn.label} (${conn.provider}, ${conn.status})`);
console.log("watch: tail -f data/worker.log");

await queue.close();
await redis.quit();
await prisma.$disconnect();
