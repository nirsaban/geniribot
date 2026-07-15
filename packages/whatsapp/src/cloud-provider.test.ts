import { describe, expect, it, vi } from "vitest";
import { CloudApiProvider, parseCloudWebhook } from "./cloud-provider.js";

describe("CloudApiProvider.send", () => {
  it("POSTs a text message to the Graph API with the right shape", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response("{}", { status: 200 }),
    );
    const provider = new CloudApiProvider(
      async () => ({ phoneNumberId: "PNID", accessToken: "TOKEN", apiVersion: "v21.0" }),
      fetchMock as unknown as typeof fetch,
    );
    await provider.send({ connectionId: "c1", to: "+972 50-123-4567", text: "שלום" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/PNID/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer TOKEN");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "972501234567", type: "text" });
    expect(body.text.body).toBe("שלום");
  });

  it("throws when the connection is not configured", async () => {
    const provider = new CloudApiProvider(async () => null);
    await expect(provider.send({ connectionId: "x", to: "1", text: "y" })).rejects.toThrow();
  });
});

describe("parseCloudWebhook", () => {
  it("extracts inbound text messages with the phone-number id", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PNID" },
                messages: [
                  { from: "972501112222", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "היי" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const msgs = parseCloudWebhook(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ phoneNumberId: "PNID", from: "972501112222", text: "היי", externalId: "wamid.1" });
  });

  it("reads interactive button replies and ignores empty/status events", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "P" },
                messages: [
                  { from: "111", id: "a", type: "interactive", interactive: { button_reply: { title: "מכירה" } } },
                  { from: "222", id: "b", type: "image" }, // no text -> skipped
                ],
                statuses: [{ status: "delivered" }],
              },
            },
          ],
        },
      ],
    };
    const msgs = parseCloudWebhook(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe("מכירה");
  });

  it("returns [] for a non-message payload", () => {
    expect(parseCloudWebhook({})).toEqual([]);
    expect(parseCloudWebhook({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
  });
});
