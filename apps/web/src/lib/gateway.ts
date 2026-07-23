import "server-only";

/**
 * Server-side client for the WhatsApp gateway's internal API. The internal
 * token never reaches the browser — the web server proxies everything.
 */
const BASE = process.env.GATEWAY_URL ?? "http://localhost:4020";
const TOKEN = process.env.GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-token": TOKEN,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`gateway ${path} -> ${res.status}`);
  }
  return (await res.json()) as T;
}

export type GatewayStatus =
  | "pending"
  | "qr"
  | "connected"
  | "disconnected"
  | "logged_out";

export function gatewayConnect(id: string, organizationId: string) {
  return call(`/connections/${id}/connect`, {
    method: "POST",
    body: JSON.stringify({ organizationId }),
  });
}

export function gatewayLogout(id: string) {
  return call(`/connections/${id}/logout`, { method: "POST" });
}

export function gatewayState(id: string) {
  return call<{ status: GatewayStatus; qr?: string }>(`/connections/${id}/state`);
}

export function gatewayCreateGroup(
  id: string,
  subject: string,
  phones: string[],
  welcome?: string,
) {
  return call<{ ok: boolean; groupJid: string; added: string[]; failed: string[] }>(
    `/connections/${id}/group`,
    { method: "POST", body: JSON.stringify({ subject, phones, welcome }) },
  );
}

/** Best-effort — the gateway may be down; callers can degrade gracefully. */
export async function safeGatewayState(
  id: string,
): Promise<{ status: GatewayStatus; qr?: string } | null> {
  try {
    return await gatewayState(id);
  } catch {
    return null;
  }
}
