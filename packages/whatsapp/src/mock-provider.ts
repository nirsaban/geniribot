import type {
  ConnectionStatus,
  OutboundMessage,
  ProviderHandlers,
  WhatsAppProvider,
} from "./index.js";

/**
 * In-memory provider for local dev and tests. It never touches WhatsApp:
 * `send` records outbound messages, and `inject` simulates an inbound message.
 * Lets us exercise the full gateway → worker → flow-engine loop before Baileys
 * is wired in (Phase 1).
 */
export class MockProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly sent: OutboundMessage[] = [];
  private statuses = new Map<string, ConnectionStatus>();

  constructor(private readonly handlers: ProviderHandlers) {}

  async connect(connectionId: string): Promise<void> {
    this.statuses.set(connectionId, "connected");
    await this.handlers.onStatus({ connectionId, status: "connected" });
  }

  async disconnect(connectionId: string): Promise<void> {
    this.statuses.set(connectionId, "disconnected");
    await this.handlers.onStatus({ connectionId, status: "disconnected" });
  }

  async logout(connectionId: string): Promise<void> {
    this.statuses.set(connectionId, "logged_out");
    await this.handlers.onStatus({ connectionId, status: "logged_out" });
  }

  async send(msg: OutboundMessage): Promise<void> {
    this.sent.push(msg);
  }

  status(connectionId: string): ConnectionStatus {
    return this.statuses.get(connectionId) ?? "pending";
  }

  /**
   * Test/dev helper: simulate an inbound message from a lead. `from` may be a
   * bare number (assumed to be a normal phone) or a full JID, so LID senders
   * can be exercised too.
   */
  async inject(connectionId: string, from: string, text: string): Promise<void> {
    const fromJid = from.includes("@") ? from : `${from}@s.whatsapp.net`;
    await this.handlers.onInbound({
      connectionId,
      from: from.split("@")[0] ?? from,
      fromJid,
      text,
      externalId: `mock-${from}-${text.length}`,
      timestamp: 0,
    });
  }
}
