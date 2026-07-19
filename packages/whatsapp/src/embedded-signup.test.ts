import { describe, expect, it, vi } from "vitest";
import {
  completeEmbeddedSignup,
  exchangeCode,
  getDisplayNumber,
  registerPhone,
  subscribeApp,
} from "./embedded-signup.js";

const CFG = { appId: "APPID", appSecret: "SECRET", apiVersion: "v21.0" };

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
const mkFetch = (impl: FetchFn) => vi.fn<FetchFn>(impl);

describe("exchangeCode", () => {
  it("GETs oauth/access_token with app id/secret + code and returns the token", async () => {
    const fetchMock = mkFetch(async () => okJson({ access_token: "BIZ_TOKEN" }));
    const token = await exchangeCode("CODE123", CFG, fetchMock as unknown as typeof fetch);

    expect(token).toBe("BIZ_TOKEN");
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/v21.0/oauth/access_token");
    expect(url.searchParams.get("client_id")).toBe("APPID");
    expect(url.searchParams.get("client_secret")).toBe("SECRET");
    expect(url.searchParams.get("code")).toBe("CODE123");
  });

  it("throws on a Graph error", async () => {
    const fetchMock = mkFetch(async () => okJson({ error: { message: "bad code" } }, 400));
    await expect(
      exchangeCode("x", CFG, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/bad code/);
  });

  it("throws when no access_token comes back", async () => {
    const fetchMock = mkFetch(async () => okJson({}));
    await expect(
      exchangeCode("x", CFG, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/no access_token/);
  });
});

describe("registerPhone", () => {
  it("POSTs /register with messaging_product + pin and Bearer token", async () => {
    const fetchMock = mkFetch(async () => okJson({ success: true }));
    await registerPhone("PNID", "TOK", "123456", CFG, fetchMock as unknown as typeof fetch);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/PNID/register");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer TOK");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ messaging_product: "whatsapp", pin: "123456" });
  });

  it("treats an already-registered number (subcode 139001) as success", async () => {
    const fetchMock = mkFetch(async () =>
      okJson({ error: { message: "already registered", error_subcode: 139001 } }, 400),
    );
    await expect(
      registerPhone("PNID", "TOK", "123456", CFG, fetchMock as unknown as typeof fetch),
    ).resolves.toBeUndefined();
  });

  it("throws on other registration errors", async () => {
    const fetchMock = mkFetch(async () => okJson({ error: { message: "boom" } }, 400));
    await expect(
      registerPhone("PNID", "TOK", "123456", CFG, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/boom/);
  });
});

describe("subscribeApp", () => {
  it("POSTs /{waba}/subscribed_apps with the Bearer token", async () => {
    const fetchMock = mkFetch(async () => okJson({ success: true }));
    await subscribeApp("WABA", "TOK", CFG, fetchMock as unknown as typeof fetch);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/WABA/subscribed_apps");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer TOK");
  });

  it("throws on error", async () => {
    const fetchMock = mkFetch(async () => okJson({ error: { message: "nope" } }, 400));
    await expect(
      subscribeApp("WABA", "TOK", CFG, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/nope/);
  });
});

describe("getDisplayNumber", () => {
  it("returns the display_phone_number", async () => {
    const fetchMock = mkFetch(async () => okJson({ display_phone_number: "+972 50-123-4567" }));
    const num = await getDisplayNumber("PNID", "TOK", CFG, fetchMock as unknown as typeof fetch);
    expect(num).toBe("+972 50-123-4567");
  });

  it("returns null (best-effort) on error", async () => {
    const fetchMock = mkFetch(async () => okJson({ error: {} }, 400));
    const num = await getDisplayNumber("PNID", "TOK", CFG, fetchMock as unknown as typeof fetch);
    expect(num).toBeNull();
  });
});

describe("completeEmbeddedSignup", () => {
  it("runs exchange → register → subscribe → getNumber in order", async () => {
    const calls: string[] = [];
    const fetchMock = mkFetch(async (url: string) => {
      if (url.includes("/oauth/access_token")) {
        calls.push("exchange");
        return okJson({ access_token: "BIZ" });
      }
      if (url.includes("/register")) {
        calls.push("register");
        return okJson({ success: true });
      }
      if (url.includes("/subscribed_apps")) {
        calls.push("subscribe");
        return okJson({ success: true });
      }
      calls.push("number");
      return okJson({ display_phone_number: "+972 50-000-0000" });
    });

    const result = await completeEmbeddedSignup(
      { code: "C", phoneNumberId: "PNID", wabaId: "WABA", pin: "123456" },
      CFG,
      fetchMock as unknown as typeof fetch,
    );

    expect(calls).toEqual(["exchange", "register", "subscribe", "number"]);
    expect(result).toEqual({
      wabaId: "WABA",
      phoneNumberId: "PNID",
      accessToken: "BIZ",
      displayPhoneNumber: "+972 50-000-0000",
    });
  });
});
