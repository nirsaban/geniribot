import { describe, expect, it } from "vitest";
import {
  buildLeadWhere,
  formatFieldValue,
  leadVisibility,
  STALE_DAYS,
  toCsv,
} from "./leads";
import type { FieldSpec } from "@kesher/flow-engine";
import type { Prisma } from "@kesher/db";

const ORG = "org_1";

/** Prisma types `AND` as `T | T[]`; every call here builds the array form. */
function andClauses(where: Prisma.ContactWhereInput): Prisma.ContactWhereInput[] {
  const and = where.AND;
  if (!Array.isArray(and)) throw new Error(`expected an AND array, got ${JSON.stringify(and)}`);
  return and;
}
const spec = (over: Partial<FieldSpec> = {}): FieldSpec => ({
  key: "k",
  label: "L",
  expect: "text",
  order: 0,
  ...over,
});

describe("leadVisibility", () => {
  it("does not restrict admins or owners", () => {
    expect(leadVisibility({ userId: "u1", role: "ADMIN" })).toBeNull();
    expect(leadVisibility({ userId: "u1", role: "OWNER" })).toBeNull();
  });

  it("restricts an agent to their own leads plus the unassigned pool", () => {
    expect(leadVisibility({ userId: "u1", role: "AGENT" })).toEqual({
      OR: [{ ownerUserId: "u1" }, { ownerUserId: null }],
    });
  });

  it("is unrestricted when there is no viewer", () => {
    expect(leadVisibility(undefined)).toBeNull();
  });
});

describe("buildLeadWhere", () => {
  it("always scopes to the organization", () => {
    expect(buildLeadWhere(ORG, {}).organizationId).toBe(ORG);
  });

  it("searches name, phone and call summary", () => {
    const where = buildLeadWhere(ORG, { q: " דנה " });
    // Trimmed, and searched across all three columns.
    expect(where.AND).toEqual([
      {
        OR: [
          { name: { contains: "דנה", mode: "insensitive" } },
          { phone: { contains: "דנה" } },
          { callSummary: { contains: "דנה", mode: "insensitive" } },
        ],
      },
    ]);
  });

  it("keeps search and agent visibility as separate AND clauses", () => {
    // The regression this guards: both need an OR, and assigning `where.OR`
    // twice would drop one — if visibility lost, an agent would see every lead
    // in the org the moment they typed in the search box.
    const where = buildLeadWhere(ORG, { q: "x" }, { userId: "u1", role: "AGENT" });
    expect(andClauses(where)).toHaveLength(2);
    expect(andClauses(where)[0]).toEqual({ OR: [{ ownerUserId: "u1" }, { ownerUserId: null }] });
    expect(where.OR).toBeUndefined();
  });

  it("ignores a status that is not a real LeadStatus", () => {
    expect(buildLeadWhere(ORG, { status: "DROPPED" }).status).toBeUndefined();
    expect(buildLeadWhere(ORG, { status: "WON" }).status).toBe("WON");
  });

  it("treats owner=none as unassigned, distinct from any owner", () => {
    expect(buildLeadWhere(ORG, { owner: "none" }).ownerUserId).toBeNull();
    expect(buildLeadWhere(ORG, { owner: "u7" }).ownerUserId).toBe("u7");
    expect(buildLeadWhere(ORG, {}).ownerUserId).toBeUndefined();
  });

  it("treats flow=none as leads from no scenario", () => {
    expect(buildLeadWhere(ORG, { flow: "none" }).sourceFlowId).toBeNull();
    expect(buildLeadWhere(ORG, { flow: "f1" }).sourceFlowId).toBe("f1");
  });

  it("filters by tag membership", () => {
    expect(buildLeadWhere(ORG, { tag: "VIP" }).tags).toEqual({ has: "VIP" });
  });

  it("includes the whole of the `to` day", () => {
    const where = buildLeadWhere(ORG, { from: "2026-07-01", to: "2026-07-31" });
    const range = where.createdAt as { gte: Date; lt: Date };
    expect(range.gte.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    // Exclusive upper bound one day on, so leads created on the 31st still match.
    expect(range.lt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("ignores unparseable dates rather than matching nothing", () => {
    expect(buildLeadWhere(ORG, { from: "not-a-date" }).createdAt).toBeUndefined();
  });

  it("adds the stale clause under AND so it cannot clobber the search", () => {
    const where = buildLeadWhere(ORG, { q: "a", stale: "1" });
    expect(andClauses(where)).toHaveLength(2);
    const stale = andClauses(where)[1] as { status: unknown; OR: unknown[] };
    expect(stale.status).toEqual({ notIn: ["WON", "LOST"] });
    // A lead the bot never reached counts as stale from creation.
    expect(stale.OR).toHaveLength(2);
  });

  it("only applies the stale filter when explicitly enabled", () => {
    expect(buildLeadWhere(ORG, {}).AND).toBeUndefined();
    expect(buildLeadWhere(ORG, { stale: "0" }).AND).toBeUndefined();
  });

  it("uses a stale window of a week", () => {
    expect(STALE_DAYS).toBe(7);
  });
});

describe("formatFieldValue", () => {
  it("renders empty-ish values as an empty string", () => {
    expect(formatFieldValue(spec(), null)).toBe("");
    expect(formatFieldValue(spec(), undefined)).toBe("");
    expect(formatFieldValue(spec(), "")).toBe("");
  });

  it("keeps zero, which is a real answer", () => {
    expect(formatFieldValue(spec({ expect: "number" }), 0)).toBe("0");
  });

  it("formats dates by the declared type", () => {
    expect(formatFieldValue(spec({ expect: "date" }), "2026-03-04")).toMatch(/2026/);
  });

  it("falls back to the raw string when a date will not parse", () => {
    expect(formatFieldValue(spec({ expect: "date" }), "בקרוב")).toBe("בקרוב");
  });

  it("serialises objects rather than rendering [object Object]", () => {
    expect(formatFieldValue(spec(), { a: 1 })).toBe('{"a":1}');
  });

  it("works with no spec at all, for keys outside the schema", () => {
    expect(formatFieldValue(undefined, "חיפה")).toBe("חיפה");
  });
});

describe("toCsv", () => {
  it("starts with a UTF-8 BOM", () => {
    // Without it Excel on Hebrew Windows reads the file as the local ANSI
    // codepage and mojibakes every column.
    expect(toCsv(["a"], [["b"]]).charCodeAt(0)).toBe(0xfeff);
  });

  it("separates rows with CRLF", () => {
    expect(toCsv(["a"], [["b"], ["c"]])).toBe("﻿a\r\nb\r\nc");
  });

  it("quotes cells containing commas, quotes or newlines", () => {
    expect(toCsv(["h"], [["a,b"]])).toContain('"a,b"');
    expect(toCsv(["h"], [['say "hi"']])).toContain('"say ""hi"""');
    expect(toCsv(["h"], [["line1\nline2"]])).toContain('"line1\nline2"');
  });

  it("neutralises cells Excel would execute as a formula", () => {
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      const out = toCsv(["h"], [[dangerous]]);
      expect(out).toContain(`'${dangerous}`);
    }
  });

  it("leaves ordinary text untouched", () => {
    expect(toCsv(["שם"], [["דנה"]])).toBe("﻿שם\r\nדנה");
  });
});
