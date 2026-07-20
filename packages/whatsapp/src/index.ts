/**
 * Provider-agnostic WhatsApp layer.
 *
 * The rest of the system talks ONLY to these interfaces. Today the concrete
 * implementation is Baileys (unofficial, lands in Phase 1 as BaileysProvider in
 * apps/gateway); later we drop in a CloudApiProvider (official WhatsApp Business
 * Cloud API) with zero changes to the flow engine, worker, or dashboard.
 *
 * See docs/DECISIONS.md ADR-001.
 */

export type ConnectionStatus =
  | "pending"
  | "qr"
  | "connected"
  | "disconnected"
  | "logged_out";

/** Normalized inbound message, provider-independent. */
export interface InboundMessage {
  connectionId: string;
  /** Sender phone in E.164-ish digits (no whatsapp suffix). */
  from: string;
  /**
   * The sender's full addressable JID, domain included — e.g.
   * `972501234567@s.whatsapp.net` or `14396898152593@lid`.
   *
   * `from` alone is NOT routable: WhatsApp's LID ("hidden number") addressing
   * hands us an opaque id whose domain is `@lid`, and re-attaching the default
   * `@s.whatsapp.net` builds a JID for a phone number that does not exist —
   * Baileys then sends into the void without throwing. Reply to `fromJid`.
   */
  fromJid: string;
  /**
   * The alternate address WhatsApp attached to this message, if any. For a LID
   * chat this is the phone-number JID. Raw — use `senderPn` for the resolved
   * number.
   */
  senderAltJid?: string | null;
  /**
   * The sender's real phone number, once resolved for a LID chat. Absent when
   * WhatsApp does not expose it, in which case `from` is still the LID and the
   * CRM shows the contact as "hidden number".
   */
  senderPn?: string;
  text: string;
  /** Provider message id, for idempotency. */
  externalId: string;
  timestamp: number;
  /** Raw provider payload for debugging/audit. */
  raw?: unknown;
}

/** Normalized outbound message. */
export interface OutboundMessage {
  connectionId: string;
  to: string;
  /**
   * Full destination JID, when the caller knows it (see `InboundMessage.fromJid`).
   * Takes precedence over `to` for JID-addressed providers (Baileys). The Cloud
   * API addresses by phone number and ignores this.
   */
  toJid?: string;
  text: string;
}

export interface QrEvent {
  connectionId: string;
  /** QR string to render for the user to scan. */
  qr: string;
}

export interface StatusEvent {
  connectionId: string;
  status: ConnectionStatus;
  phoneNumber?: string;
}

/** Opaque, serializable auth/session state persisted per connection. */
export type AuthState = Record<string, unknown>;

export interface AuthStore {
  load(connectionId: string): Promise<AuthState | null>;
  save(connectionId: string, state: AuthState): Promise<void>;
  clear(connectionId: string): Promise<void>;
}

export interface ProviderHandlers {
  onInbound(msg: InboundMessage): void | Promise<void>;
  onQr(evt: QrEvent): void | Promise<void>;
  onStatus(evt: StatusEvent): void | Promise<void>;
}

/**
 * A WhatsApp provider manages many connections (one per tenant number) and
 * emits normalized events. Implementations: BaileysProvider (now),
 * CloudApiProvider (later).
 */
export interface WhatsAppProvider {
  readonly name: string;
  /** Start/resume a connection; triggers onQr if pairing is needed. */
  connect(connectionId: string): Promise<void>;
  /** Gracefully stop a connection (keeps auth state). */
  disconnect(connectionId: string): Promise<void>;
  /** Stop and wipe auth state (full logout / re-pair required). */
  logout(connectionId: string): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
  status(connectionId: string): ConnectionStatus;
}

export * from "./mock-provider.js";
export * from "./baileys-provider.js";
export * from "./cloud-provider.js";
export * from "./embedded-signup.js";
