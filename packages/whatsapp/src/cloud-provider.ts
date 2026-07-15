import type {
  ConnectionStatus,
  OutboundMessage,
  WhatsAppProvider,
} from "./index.js";

/**
 * Official WhatsApp Business Cloud API provider (Meta Graph API).
 *
 * Unlike Baileys, the Cloud API is stateless and webhook-driven: there is no
 * socket to keep alive and no QR to scan. A connection is "connected" once its
 * phone-number id + access token are configured; inbound messages arrive via
 * the public webhook (see the web app's /api/webhooks/whatsapp), and outbound
 * is a REST call. This is the production endgame off Baileys' ban risk — and it
 * slots behind the exact same WhatsAppProvider interface (ADR-001).
 */

export interface CloudApiConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
}

const GRAPH = "https://graph.facebook.com";
const DEFAULT_VERSION = "v21.0";

export class CloudApiProvider implements WhatsAppProvider {
  readonly name = "cloud_api";

  /** Resolves each connection's Cloud API config (token decrypted by caller). */
  constructor(
    private readonly loadConfig: (connectionId: string) => Promise<CloudApiConfig | null>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(_connectionId: string): ConnectionStatus {
    // Cloud API connections are considered connected once configured; the DB
    // status is the source of truth and is set at configuration time.
    return "connected";
  }

  // No socket lifecycle — configuration happens in the dashboard.
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async logout(): Promise<void> {}

  async send(msg: OutboundMessage): Promise<void> {
    const cfg = await this.loadConfig(msg.connectionId);
    if (!cfg) throw new Error(`cloud_api connection ${msg.connectionId} not configured`);
    const version = cfg.apiVersion ?? DEFAULT_VERSION;
    const res = await this.fetchImpl(
      `${GRAPH}/${version}/${cfg.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: msg.to.replace(/[^\d]/g, ""),
          type: "text",
          text: { preview_url: false, body: msg.text },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`cloud_api send ${res.status}: ${await res.text()}`);
    }
  }
}

/** Normalize a Meta webhook payload into inbound messages (provider-agnostic). */
export interface CloudInbound {
  phoneNumberId: string;
  from: string;
  text: string;
  externalId: string;
  timestamp: number;
}

export function parseCloudWebhook(body: unknown): CloudInbound[] {
  const out: CloudInbound[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes ?? [];
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value ?? {};
      const phoneNumberId = (value.metadata as { phone_number_id?: string })?.phone_number_id;
      const messages = (value.messages as unknown[]) ?? [];
      if (!phoneNumberId) continue;
      for (const m of messages) {
        const msg = m as {
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: {
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
        };
        const text =
          msg.text?.body ??
          msg.button?.text ??
          msg.interactive?.button_reply?.title ??
          msg.interactive?.list_reply?.title;
        if (!msg.from || !text) continue;
        out.push({
          phoneNumberId,
          from: msg.from.replace(/[^\d]/g, ""),
          text,
          externalId: msg.id ?? `${msg.from}-${msg.timestamp ?? ""}`,
          timestamp: Number(msg.timestamp ?? 0),
        });
      }
    }
  }
  return out;
}
