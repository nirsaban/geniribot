import {
  BufferJSON,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  makeWASocket,
  proto,
} from "baileys";
import type {
  AuthenticationCreds,
  SignalDataTypeMap,
  SignalKeyStore,
  WASocket,
} from "baileys";
import pino from "pino";

// baileys 7 ships as pure ESM, so `proto` is a normal named import. (Under 6.x
// it had to be pulled from the CJS module via createRequire, because Node's
// CJS→ESM named-export detection missed it — that no longer applies, and would
// now fail outright since there is no CJS build to require.)
import type {
  AuthStore,
  ConnectionStatus,
  OutboundMessage,
  ProviderHandlers,
  WhatsAppProvider,
} from "./index.js";

/**
 * Baileys implementation of WhatsAppProvider (unofficial WhatsApp Web).
 *
 * One provider instance manages many connections (one per tenant number).
 * Auth/session state is persisted through the injected AuthStore (Postgres in
 * the gateway) as a single JSON blob per connection, so a restart re-hydrates
 * sessions without re-scanning the QR. See docs/ARCHITECTURE.md §6, ADR-001.
 */

interface Session {
  sock: WASocket;
  status: ConnectionStatus;
  /** guards against overlapping reconnect attempts */
  reconnecting: boolean;
}

/** Shape we persist: creds + a flat keys map (`${type}-${id}` → value). */
interface AuthBlob {
  creds: AuthenticationCreds;
  keys: Record<string, unknown>;
}

const RECONNECT_DELAY_MS = 3000;
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL ?? "silent" });

/**
 * Inbound tracing. `normalizeInbound` drops messages silently by design, which
 * makes "the bot ignored me" impossible to diagnose from logs. With
 * WA_TRACE_INBOUND=1 every message is logged BEFORE the filters, along with the
 * reason it was dropped (or that it was accepted).
 */
const TRACE_INBOUND = process.env.WA_TRACE_INBOUND === "1";
const trace = pino({ level: "info" }).child({ service: "wa:trace" });

export class BaileysProvider implements WhatsAppProvider {
  readonly name = "baileys";
  private sessions = new Map<string, Session>();

  constructor(
    private readonly authStore: AuthStore,
    private readonly handlers: ProviderHandlers,
  ) {}

  status(connectionId: string): ConnectionStatus {
    return this.sessions.get(connectionId)?.status ?? "pending";
  }

  async connect(connectionId: string): Promise<void> {
    const existing = this.sessions.get(connectionId);
    if (existing && (existing.status === "connected" || existing.status === "qr")) {
      return; // already live / pairing
    }
    await this.startSocket(connectionId);
  }

  async disconnect(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (session) {
      try {
        session.sock.end(undefined);
      } catch {
        /* ignore */
      }
      this.sessions.delete(connectionId);
    }
    await this.setStatus(connectionId, "disconnected");
  }

  async logout(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (session) {
      try {
        await session.sock.logout();
      } catch {
        /* ignore */
      }
      this.sessions.delete(connectionId);
    }
    await this.authStore.clear(connectionId);
    await this.setStatus(connectionId, "logged_out");
  }

  async send(msg: OutboundMessage): Promise<void> {
    const session = this.sessions.get(msg.connectionId);
    if (!session || session.status !== "connected") {
      throw new Error(`connection ${msg.connectionId} is not connected`);
    }
    // Prefer the JID we actually received the message on — `to` has had its
    // domain stripped and cannot be reconstructed for @lid senders.
    await session.sock.sendMessage(msg.toJid ?? toJid(msg.to), { text: msg.text });
  }

  // ---------- internals ----------
  private async startSocket(connectionId: string): Promise<void> {
    const { creds, keys, persist } = await this.loadAuth(connectionId);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: undefined as [number, number, number] | undefined,
    }));

    const sock = makeWASocket({
      auth: { creds, keys: makeCacheableSignalKeyStore(keys, logger) },
      logger,
      ...(version ? { version } : {}),
      browser: ["GeniriBot", "Chrome", "1.0.0"],
      markOnlineOnConnect: false,
    });

    const session: Session = { sock, status: "pending", reconnecting: false };
    this.sessions.set(connectionId, session);

    // Persist the initial creds immediately so the device identity is stable
    // across restarts even before pairing completes.
    void persist();

    sock.ev.on("creds.update", () => {
      void persist();
    });

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        session.status = "qr";
        void this.handlers.onQr({ connectionId, qr });
        void this.setStatus(connectionId, "qr");
      }
      if (connection === "open") {
        session.status = "connected";
        const phone = sock.user?.id?.split(":")[0];
        void this.setStatus(connectionId, "connected", phone);
      }
      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })
          ?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        if (loggedOut) {
          this.sessions.delete(connectionId);
          void this.authStore.clear(connectionId);
          void this.setStatus(connectionId, "logged_out");
        } else {
          void this.scheduleReconnect(connectionId, session);
        }
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      // `type` is "notify" for live messages and "append" for history/sync
      // batches; only the former is a real incoming message. Trace both so a
      // wrong-type drop is distinguishable from nothing arriving at all.
      if (TRACE_INBOUND) {
        trace.info({ connectionId, type, count: messages.length }, "messages.upsert");
      }
      if (type !== "notify") return;
      for (const m of messages) {
        const inbound = normalizeInbound(connectionId, m);
        if (!inbound) continue;
        // Resolving the LID→phone mapping is async, so it happens here rather
        // than inside the pure normalizer.
        void this.withResolvedPhone(sock, inbound).then((msg) => this.handlers.onInbound(msg));
      }
    });
  }

  /**
   * Fill in the sender's real phone number for LID ("hidden number") chats.
   *
   * WhatsApp addresses these with an opaque id, so `from` would otherwise hold
   * something undialable. Two sources, cheapest first:
   *
   *  1. `key.remoteJidAlt` — the alternate address carried on the message
   *     itself, present when WhatsApp already knows both identities.
   *  2. `signalRepository.lidMapping.getPNForLID` — the mapping store, fed by
   *     history sync at pair time.
   *
   * Best-effort: if neither knows the number we keep the LID, exactly as
   * before. A lookup failure must never drop a lead's message.
   */
  private async withResolvedPhone(
    sock: WASocket,
    msg: import("./index.js").InboundMessage,
  ): Promise<import("./index.js").InboundMessage> {
    if (!msg.fromJid.endsWith("@lid")) return msg;

    const fromAlt = toPhoneUser(msg.senderAltJid);
    if (fromAlt) return { ...msg, from: fromAlt, senderPn: fromAlt };

    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(msg.fromJid);
      const user = toPhoneUser(pn);
      if (user) return { ...msg, from: user, senderPn: user };
    } catch (err) {
      logger.warn({ err, jid: msg.fromJid }, "lid→pn lookup failed");
    }
    if (TRACE_INBOUND) {
      trace.info({ connectionId: msg.connectionId, jid: msg.fromJid }, "lid→pn unresolved");
    }
    return msg;
  }

  private async scheduleReconnect(connectionId: string, session: Session): Promise<void> {
    if (session.reconnecting) return;
    session.reconnecting = true;
    session.status = "disconnected";
    await this.setStatus(connectionId, "disconnected");
    setTimeout(() => {
      this.sessions.delete(connectionId);
      void this.startSocket(connectionId).catch(() => {
        /* next inbound / manual retry will try again */
      });
    }, RECONNECT_DELAY_MS);
  }

  private async setStatus(
    connectionId: string,
    status: ConnectionStatus,
    phoneNumber?: string,
  ): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (session) session.status = status;
    await this.handlers.onStatus({ connectionId, status, phoneNumber });
  }

  /** Build Baileys creds + a keystore backed by the AuthStore blob. */
  private async loadAuth(connectionId: string): Promise<{
    creds: AuthenticationCreds;
    keys: SignalKeyStore;
    persist: () => Promise<void>;
  }> {
    const raw = await this.authStore.load(connectionId);
    const blob: AuthBlob = raw
      ? (JSON.parse(JSON.stringify(raw), BufferJSON.reviver) as AuthBlob)
      : { creds: initAuthCreds(), keys: {} };

    const creds = blob.creds;
    const keyMap = blob.keys;

    const persist = async () => {
      const serializable = JSON.parse(
        JSON.stringify({ creds, keys: keyMap }, BufferJSON.replacer),
      );
      await this.authStore.save(connectionId, serializable);
    };

    const keys: SignalKeyStore = {
      get: async (type, ids) => {
        const out: Record<string, unknown> = {};
        for (const id of ids) {
          let value = keyMap[`${type}-${id}`];
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          out[id] = value;
        }
        return out as { [id: string]: SignalDataTypeMap[typeof type] };
      },
      set: async (data) => {
        for (const category in data) {
          const cat = data[category as keyof typeof data];
          for (const id in cat) {
            const value = cat[id];
            const key = `${category}-${id}`;
            if (value) keyMap[key] = value;
            else delete keyMap[key];
          }
        }
        await persist();
      },
    };

    return { creds, keys, persist };
  }
}

/**
 * The user part of a phone-number JID, or null for anything else.
 *
 * Guards against treating a second LID (or a group/broadcast address) as a
 * phone number just because it turned up in an "alternate address" slot.
 */
function toPhoneUser(jid: string | null | undefined): string | null {
  if (!jid || !jid.includes("@s.whatsapp.net")) return null;
  const user = jid.split("@")[0]?.split(":")[0] ?? "";
  return /^\d{6,15}$/.test(user) ? user : null;
}

function toJid(to: string): string {
  return to.includes("@") ? to : `${to.replace(/[^\d]/g, "")}@s.whatsapp.net`;
}

interface WAMessageLike {
  key: {
    remoteJid?: string | null;
    fromMe?: boolean | null;
    id?: string | null;
    /**
     * Alternate addresses, added in baileys 7: when a chat is LID-addressed
     * these carry the phone-number JID (and vice versa).
     */
    remoteJidAlt?: string | null;
    participantAlt?: string | null;
  };
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
  } | null;
  messageTimestamp?: number | Long | null;
}
type Long = { toNumber(): number };

function normalizeInbound(
  connectionId: string,
  m: WAMessageLike,
): import("./index.js").InboundMessage | null {
  const jid = m.key.remoteJid;
  // What kind of payload did WhatsApp actually send? Only `conversation` and
  // `extendedTextMessage` carry text we can read; everything else is dropped
  // below, so surfacing the key here is what makes a silent drop explainable.
  const kinds = Object.keys((m.message ?? {}) as Record<string, unknown>);
  const drop = (reason: string) => {
    if (TRACE_INBOUND) {
      trace.info({ connectionId, jid, fromMe: m.key.fromMe ?? false, kinds, reason }, "inbound dropped");
    }
    return null;
  };

  if (!jid || m.key.fromMe) return drop(!jid ? "no-jid" : "fromMe");
  // Skip groups, status broadcasts, newsletters — 1:1 lead chats only for MVP.
  if (jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter")) {
    return drop("not-a-1:1-chat");
  }
  const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? null;
  if (!text) return drop(kinds.length === 0 ? "empty-message" : "unsupported-type");

  if (TRACE_INBOUND) {
    trace.info({ connectionId, jid, kinds, textLen: text.length }, "inbound accepted");
  }

  const ts = m.messageTimestamp;
  const timestamp = typeof ts === "number" ? ts : (ts?.toNumber?.() ?? 0);

  return {
    connectionId,
    from: jid.split("@")[0] ?? jid,
    fromJid: jid,
    // The alternate address WhatsApp attached to this message, if any — for a
    // LID chat this is the phone-number JID. Resolved into `from` by the caller.
    senderAltJid: m.key.remoteJidAlt ?? m.key.participantAlt ?? null,
    text,
    externalId: m.key.id ?? `${jid}-${timestamp}`,
    timestamp,
  };
}
