import { childLogger } from "@kesher/core";
import { prisma } from "@kesher/db";
import {
  BaileysProvider,
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
  private readonly orgIds = new Map<string, string>();
  private readonly liveState = new Map<string, { status: ConnectionStatus; qr?: string }>();

  constructor() {
    const handlers: ProviderHandlers = {
      onInbound: (msg) => this.onInbound(msg),
      onQr: (evt) => this.onQr(evt),
      onStatus: (evt) => this.onStatus(evt),
    };
    this.provider = new BaileysProvider(new PrismaAuthStore(), handlers);
  }

  /** Reconnect connections that were previously paired, on gateway boot. */
  async resumeAll(): Promise<void> {
    const rows = await prisma.whatsAppConnection.findMany({
      where: { status: { in: ["CONNECTED", "QR", "DISCONNECTED"] } },
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
    this.liveState.set(connectionId, { status: "pending" });
    await this.provider.connect(connectionId);
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.provider.disconnect(connectionId);
  }

  async logout(connectionId: string): Promise<void> {
    await this.provider.logout(connectionId);
    this.liveState.delete(connectionId);
  }

  async send(connectionId: string, to: string, text: string): Promise<void> {
    await this.provider.send({ connectionId, to, text });
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
        text: msg.text,
        externalId: msg.externalId,
      },
      { jobId: `${msg.connectionId}:${msg.externalId}` }, // idempotency
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
