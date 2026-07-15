import http from "node:http";
import { Worker } from "bullmq";
import { childLogger } from "@kesher/core";
import {
  bullConnection,
  connection,
  INBOUND_QUEUE,
  REMINDERS_QUEUE,
  type InboundJob,
  type ReminderJob,
} from "./queues.js";
import { processInbound } from "./process-inbound.js";
import { processReminder } from "./process-reminder.js";

const log = childLogger("worker");

const worker = new Worker<InboundJob>(
  INBOUND_QUEUE,
  async (job) => {
    await processInbound(job.data);
  },
  { connection: bullConnection, concurrency: 8 },
);

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "inbound job failed");
});
worker.on("completed", (job) => {
  log.debug({ jobId: job.id }, "inbound job completed");
});

// Delayed appointment reminders (−24h / −1h).
const reminderWorker = new Worker<ReminderJob>(
  REMINDERS_QUEUE,
  async (job) => {
    await processReminder(job.data);
  },
  { connection: bullConnection, concurrency: 4 },
);
reminderWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "reminder job failed");
});

// Tiny health server so the container has a liveness probe.
const PORT = Number(process.env.WORKER_HEALTH_PORT ?? 4021);
http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "worker", ts: Date.now() }));
    } else {
      res.writeHead(404).end();
    }
  })
  .listen(PORT, () => log.info({ port: PORT }, "worker health server up"));

log.info("worker started; consuming " + INBOUND_QUEUE);

async function shutdown() {
  log.info("shutting down worker");
  await worker.close();
  await reminderWorker.close();
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
