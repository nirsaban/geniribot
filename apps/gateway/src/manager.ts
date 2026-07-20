import { childLogger, decryptSecret, loadEnv, secretsKey } from "@kesher/core";
import { prisma } from "@kesher/db";
import {
  BaileysProvider,
  CloudApiProvider,
  type CloudApiConfig,
  type ConnectionStatus,
  type InboundMessage,
  type ProviderHandlers,
  type QrEvent,
  type StatusEvent,
} from "@kesher/whatsapp";
import { PrismaAuthStore } from "./auth-store.js";
import { inboundQueue, INBOUND_JOB } from "./queues.js";

const log = childLogger("gateway:manager");

/** DB WaStatus enum values keyed by provider ConnectionStatus. */
const STATUS_TO_DB: Record<ConnectionStatus, "PENDING" | "QR" | "CONNECTED" | "DISCONNECTED" | "LOGGED_OUT"> = {
  pending: "PENDING",
  qr: "QR",
  connected: "CONNECTED",
  disconnected: "DISCONNECTED",
  logged_out: "LOGGED_OUT",
};

/**
 * Owns the WhatsApp provider and the per-connection live state (status + latest
 * QR) that the dashboard polls. Resolves each connection's organizationId so
 * inbound messages can be enqueued tenant-scoped.
 */
export class SessionManager {
  private readonly provider: BaileysProvider;
  private readonly cloud: CloudApiProvider;
  private readonly orgIds = new Map<string, string>();
  private readonly liveState = new Map<string, { status: ConnectionStatus; qr?: string }>();

  constructor() {
    const handlers: ProviderHandlers = {
      onInbound: (msg) => this.onInbound(msg),
      onQr: (evt) => this.onQr(evt),
      onStatus: (evt) => this.onStatus(evt),
    };
    this.provider = new BaileysProvider(new PrismaAuthStore(), handlers);
    this.cloud = new CloudApiProvider((id) => this.loadCloudConfig(id));
  }

  /** Reconnect Baileys connections that were previously paired, on boot.
   *  Cloud API connections are stateless — nothing to resume. */
  async resumeAll(): Promise<void> {
    const rows = await prisma.whatsAppConnection.findMany({
      where: { provider: "baileys", status: { in: ["CONNECTED", "QR", "DISCONNECTED"] } },
      select: { id: true, organizationId: true },
    });
    log.info({ count: rows.length }, "resuming connections");
    for (const row of rows) {
      this.orgIds.set(row.id, row.organizationId);
      await this.connect(row.id, row.organizationId).catch((err) =>
        log.error({ err, connectionId: row.id }, "resume failed"),
      );
    }
  }

  async connect(connectionId: string, organizationId: string): Promise<void> {
    this.orgIds.set(connectionId, organizationId);
    // Cloud API connections have no socket — they're "connected" once configured.
    if (await this.isCloud(connectionId)) {
      this.liveState.set(connectionId, { status: "connected" });
      await this.onStatus({ connectionId, status: "connected" });
      return;
    }
    this.liveState.set(connectionId, { status: "pending" });
    await this.provider.connect(connectionId);
  }

  async disconnect(connectionId: string): Promise<void> {
    if (await this.isCloud(connectionId)) {
      await this.onStatus({ connectionId, status: "disconnected" });
      return;
    }
    await this.provider.disconnect(connectionId);
  }

  async logout(connectionId: string): Promise<void> {
    if (!(await this.isCloud(connectionId))) await this.provider.logout(connectionId);
    else await this.onStatus({ connectionId, status: "logged_out" });
    this.liveState.delete(connectionId);
  }

  async send(connectionId: string, to: string, text: string, toJid?: string): Promise<void> {
    if (await this.isCloud(connectionId)) {
      // Cloud API addresses by phone number; JIDs are a Baileys concept.
      await this.cloud.send({ connectionId, to, text });
      return;
    }
    await this.provider.send({ connectionId, to, toJid, text });
  }

  private async isCloud(connectionId: string): Promise<boolean> {
    const c = await prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
      select: { provider: true },
    });
    return c?.provider === "cloud_api";
  }

  /** Decrypt a Cloud API connection's config from its authState blob. */
  private async loadCloudConfig(connectionId: string): Promise<CloudApiConfig | null> {
    const c = await prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
      select: { authState: true },
    });
    const blob = c?.authState as { phoneNumberId?: string; accessTokenEnc?: string } | null;
    if (!blob?.phoneNumberId || !blob.accessTokenEnc) return null;
    const env = loadEnv();
    try {
      const accessToken = decryptSecret(blob.accessTokenEnc, secretsKey(env.SECRETS_KEY, env.JWT_SECRET));
      return { phoneNumberId: blob.phoneNumberId, accessToken };
    } catch {
      return null;
    }
  }

  /** Live status + QR for the dashboard to poll. */
  getState(connectionId: string): { status: ConnectionStatus; qr?: string } {
    return this.liveState.get(connectionId) ?? { status: this.provider.status(connectionId) };
  }

  // ---------- provider event handlers ----------
  private async onInbound(msg: InboundMessage): Promise<void> {
    const organizationId = this.orgIds.get(msg.connectionId);
    if (!organizationId) {
      log.warn({ connectionId: msg.connectionId }, "inbound for unknown connection; dropping");
      return;
    }
    await inboundQueue.add(
      INBOUND_JOB,
      {
        organizationId,
        connectionId: msg.connectionId,
        from: msg.from,
        fromJid: msg.fromJid,
        text: msg.text,
        externalId: msg.externalId,
      },
      // BullMQ custom job ids cannot contain ":" — use "_" and strip any from the id.
      { jobId: `${msg.connectionId}_${msg.externalId.replace(/:/g, "-")}` }, // idempotency
    );
  }

  private onQr(evt: QrEvent): void {
    const prev = this.liveState.get(evt.connectionId) ?? { status: "qr" as ConnectionStatus };
    this.liveState.set(evt.connectionId, { ...prev, status: "qr", qr: evt.qr });
  }

  private async onStatus(evt: StatusEvent): Promise<void> {
    const cur = this.liveState.get(evt.connectionId) ?? {};
    // Clear the QR once we leave the pairing state.
    const qr = evt.status === "qr" ? (cur as { qr?: string }).qr : undefined;
    this.liveState.set(evt.connectionId, { status: evt.status, qr });

    await prisma.whatsAppConnection
      .update({
        where: { id: evt.connectionId },
        data: {
          status: STATUS_TO_DB[evt.status],
          ...(evt.phoneNumber ? { phoneNumber: evt.phoneNumber } : {}),
        },
      })
      .catch((err) => log.error({ err, connectionId: evt.connectionId }, "status persist failed"));
  }
}
