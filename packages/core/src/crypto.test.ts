import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, secretsKey } from "./crypto.js";

describe("crypto", () => {
  it("round-trips a secret", () => {
    const key = secretsKey(undefined, "some-fallback");
    const enc = encryptSecret("refresh-token-xyz", key);
    expect(enc).not.toContain("refresh-token");
    expect(decryptSecret(enc, key)).toBe("refresh-token-xyz");
  });

  it("produces different ciphertext each time (random iv)", () => {
    const key = secretsKey(undefined, "k");
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key));
  });

  it("fails to decrypt with the wrong key", () => {
    const enc = encryptSecret("secret", secretsKey(undefined, "a"));
    expect(() => decryptSecret(enc, secretsKey(undefined, "b"))).toThrow();
  });

  it("uses a 32-byte base64 key directly", () => {
    const raw = Buffer.alloc(32, 7).toString("base64");
    const key = secretsKey(raw);
    expect(key.length).toBe(32);
    expect(decryptSecret(encryptSecret("hi", key), key)).toBe("hi");
  });
});
