import { describe, expect, it } from "vitest";
import { hasRole, hashPassword, signSession, verifyPassword, verifySession } from "./auth.js";

const SECRET = "test-secret-at-least-16-chars-long";

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword(hash, "hunter2")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});

describe("sessions", () => {
  it("round-trips claims", async () => {
    const token = await signSession({ sub: "u1", org: "o1", role: "ADMIN" }, SECRET);
    const claims = await verifySession(token, SECRET);
    expect(claims).toEqual({ sub: "u1", org: "o1", role: "ADMIN" });
  });

  it("rejects a bad secret", async () => {
    const token = await signSession({ sub: "u1", org: "o1", role: "ADMIN" }, SECRET);
    expect(await verifySession(token, "another-secret-16-chars-xx")).toBeNull();
  });
});

describe("rbac", () => {
  it("ranks roles", () => {
    expect(hasRole("OWNER", "AGENT")).toBe(true);
    expect(hasRole("AGENT", "ADMIN")).toBe(false);
    expect(hasRole("ADMIN", "ADMIN")).toBe(true);
  });
});
