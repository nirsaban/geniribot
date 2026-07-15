import Fastify from "fastify";
import { Worker } from "bullmq";
import { childLogger } from "@kesher/core";
import { SessionManager } from "./manager.js";
import { bullConnection, connection, OUTBOUND_QUEUE, type OutboundJob } from "./queues.js";

/**
 * WhatsApp gateway — always-on, stateful service (Phase 1).
 *
 * - Manages one Baileys session per WhatsAppConnection (SessionManager).
 * - Internal REST API (token-guarded) for the web app: connect / send / state.
 * - Consumes the outbound queue and sends via the provider.
 * - On boot, resumes previously-paired connections.
 */
const log = childLogger("gateway");
const PORT = Number(process.env.GATEWAY_PORT ?? 4020);
const INTERNAL_TOKEN = process.env.GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token";

const manager = new SessionManager();
const app = Fastify({ logger: false });

app.get("/health", async () => ({ status: "ok", service: "gateway", ts: Date.now() }));

app.register(async (instance) => {
  instance.addHook("preHandler", async (req, reply) => {
    if (req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  instance.post<{ Params: { id: string }; Body: { organizationId: string } }>(
    "/connections/:id/connect",
    async (req, reply) => {
      const { organizationId } = req.body ?? {};
      if (!organizationId) return reply.code(400).send({ error: "organizationId required" });
      await manager.connect(req.params.id, organizationId);
      return { ok: true, state: manager.getState(req.params.id) };
    },
  );

  instance.post<{ Params: { id: string } }>("/connections/:id/disconnect", async (req) => {
    await manager.disconnect(req.params.id);
    return { ok: true };
  });

  instance.post<{ Params: { id: string } }>("/connections/:id/logout", async (req) => {
    await manager.logout(req.params.id);
    return { ok: true };
  });

  instance.get<{ Params: { id: string } }>("/connections/:id/state", async (req) => {
    return manager.getState(req.params.id);
  });

  instance.post<{ Params: { id: string }; Body: { to: string; text: string } }>(
    "/connections/:id/send",
    async (req, reply) => {
      const { to, text } = req.body ?? {};
      if (!to || !text) return reply.code(400).send({ error: "to and text required" });
      await manager.send(req.params.id, to, text);
      return { ok: true };
    },
  );
});

// Outbound: worker enqueues replies → gateway sends them.
const outboundWorker = new Worker<OutboundJob>(
  OUTBOUND_QUEUE,
  async (job) => {
    await manager.send(job.data.connectionId, job.data.to, job.data.text);
  },
  { connection: bullConnection, concurrency: 5 },
);
outboundWorker.on("failed", (job, err) =>
  log.error({ jobId: job?.id, err: err?.message }, "outbound send failed"),
);

async function main() {
  await app.listen({ host: "0.0.0.0", port: PORT });
  log.info({ port: PORT }, "gateway listening");
  await manager.resumeAll().catch((err) => log.error({ err }, "resumeAll failed"));
}

async function shutdown() {
  log.info("gateway shutting down");
  await outboundWorker.close();
  await app.close();
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  log.error({ err }, "gateway failed to start");
  process.exit(1);
});
