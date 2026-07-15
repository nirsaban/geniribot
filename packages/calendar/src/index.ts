import { OAuth2Client } from "google-auth-library";

/**
 * Provider-agnostic calendar layer. Today: Google Calendar. The booking flow
 * and slot generator talk only to `CalendarProvider`, and degrade gracefully
 * (no-op) when a tenant has not connected a calendar. See docs/ROADMAP.md P5.
 */

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export interface CalendarEventInput {
  summary: string;
  description?: string;
  startISO: string;
  endISO: string;
  timezone?: string;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface CalendarProvider {
  createEvent(e: CalendarEventInput): Promise<{ id: string }>;
  deleteEvent(id: string): Promise<void>;
  freeBusy(fromISO: string, toISO: string): Promise<BusyInterval[]>;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokens {
  accessToken?: string;
  refreshToken: string;
  expiryDate?: number;
}

export function oauthClient(cfg: GoogleOAuthConfig): OAuth2Client {
  return new OAuth2Client(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
}

/** Consent URL for the calendar scope (offline → returns a refresh token). */
export function buildAuthUrl(client: OAuth2Client, state: string): string {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GOOGLE_CALENDAR_SCOPE],
    state,
  });
}

export async function exchangeCode(
  client: OAuth2Client,
  code: string,
): Promise<GoogleTokens> {
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("no refresh_token returned (user may need to re-consent)");
  }
  return {
    accessToken: tokens.access_token ?? undefined,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ?? undefined,
  };
}

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarProvider implements CalendarProvider {
  constructor(
    private readonly client: OAuth2Client,
    private readonly calendarId: string = "primary",
  ) {}

  static fromTokens(
    cfg: GoogleOAuthConfig,
    tokens: GoogleTokens,
    calendarId = "primary",
  ): GoogleCalendarProvider {
    const client = oauthClient(cfg);
    client.setCredentials({
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken,
      expiry_date: tokens.expiryDate,
    });
    return new GoogleCalendarProvider(client, calendarId);
  }

  private async authHeader(): Promise<Record<string, string>> {
    const { token } = await this.client.getAccessToken();
    if (!token) throw new Error("failed to obtain Google access token");
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }

  async createEvent(e: CalendarEventInput): Promise<{ id: string }> {
    const headers = await this.authHeader();
    const body = {
      summary: e.summary,
      description: e.description,
      start: { dateTime: e.startISO, timeZone: e.timezone ?? "UTC" },
      end: { dateTime: e.endISO, timeZone: e.timezone ?? "UTC" },
    };
    const res = await fetch(
      `${CAL_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error(`google createEvent ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { id: string };
    return { id: json.id };
  }

  async deleteEvent(id: string): Promise<void> {
    const headers = await this.authHeader();
    const res = await fetch(
      `${CAL_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(id)}`,
      { method: "DELETE", headers },
    );
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`google deleteEvent ${res.status}: ${await res.text()}`);
    }
  }

  async freeBusy(fromISO: string, toISO: string): Promise<BusyInterval[]> {
    const headers = await this.authHeader();
    const res = await fetch(`${CAL_BASE}/freeBusy`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        timeMin: fromISO,
        timeMax: toISO,
        items: [{ id: this.calendarId }],
      }),
    });
    if (!res.ok) throw new Error(`google freeBusy ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    };
    const busy = json.calendars?.[this.calendarId]?.busy ?? [];
    return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }
}
