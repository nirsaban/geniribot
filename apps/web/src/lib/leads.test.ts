import { describe, expect, it } from "vitest";
import {
  buildLeadWhere,
  callbackPhone,
  choiceOptions,
  fieldInputType,
  fieldInputValue,
  formatFieldValue,
  isHiddenNumber,
  leadVisibility,
  parseFieldInput,
  STALE_DAYS,
  suggestionsByField,
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

describe("isHiddenNumber", () => {
  it("flags a LID-addressed contact", () => {
    expect(isHiddenNumber({ phone: "14396898152593", waJid: "14396898152593@lid" })).toBe(true);
  });

  it("does not flag a real number", () => {
    expect(isHiddenNumber({ phone: "972532898849", waJid: "972532898849@s.whatsapp.net" })).toBe(
      false,
    );
  });

  it("is not hidden once a LID chat has been resolved to a real number", () => {
    // The regression this guards: after baileys resolves the phone number we
    // store it in `phone` while `waJid` stays @lid (it is still the address we
    // reply to). Judging on waJid would hide a number we actually know.
    expect(isHiddenNumber({ phone: "972532898849", waJid: "14396898152593@lid" })).toBe(false);
  });

  it("judges the stored number, not the addressing", () => {
    // Real LIDs seen in production (14–15 digits).
    expect(isHiddenNumber({ phone: "14396898152593", waJid: null })).toBe(true);
    expect(isHiddenNumber({ phone: "244808924831934", waJid: null })).toBe(true);
    // Real numbers: Israeli (12) and long international (13).
    expect(isHiddenNumber({ phone: "972532898849", waJid: null })).toBe(false);
    expect(isHiddenNumber({ phone: "9725328988491", waJid: null })).toBe(false);
  });
});

describe("callbackPhone", () => {
  const phoneSpec = spec({ key: "callback", expect: "phone" });

  it("returns an answer the scenario collected as a phone", () => {
    expect(callbackPhone({ callback: "0532898849" }, [phoneSpec])).toBe("0532898849");
  });

  it("ignores fields that are not declared as phones", () => {
    expect(callbackPhone({ city: "חיפה" }, [spec({ key: "city" })])).toBeNull();
  });

  it("accepts a numeric answer", () => {
    expect(callbackPhone({ callback: 532898849 }, [phoneSpec])).toBe("532898849");
  });

  it("skips blank answers rather than returning whitespace", () => {
    expect(callbackPhone({ callback: "   " }, [phoneSpec])).toBeNull();
  });

  it("is null-safe on a missing or non-object field bag", () => {
    expect(callbackPhone(null, [phoneSpec])).toBeNull();
    expect(callbackPhone("nope", [phoneSpec])).toBeNull();
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

describe("editing collected fields", () => {
  it("offers the scenario's choices, keeping a value it no longer declares", () => {
    const s = spec({ expect: "choice", choices: ["S", "L"] });
    expect(choiceOptions(s, "S")).toEqual(["S", "L"]);
    // A since-edited scenario must not silently drop the lead's real answer.
    expect(choiceOptions(s, "XL")).toEqual(["XL", "S", "L"]);
    expect(choiceOptions(s, undefined)).toEqual(["S", "L"]);
  });

  it("renders a date as yyyy-mm-dd so the input keeps it", () => {
    expect(fieldInputValue(spec({ expect: "date" }), "2026-03-04T10:00:00.000Z")).toBe("2026-03-04");
    expect(fieldInputValue(spec({ expect: "date" }), "not a date")).toBe("not a date");
    expect(fieldInputValue(spec(), null)).toBe("");
  });

  it("parses a number field to a number, keeping unparseable text as typed", () => {
    const n = spec({ expect: "number" });
    expect(parseFieldInput(n, " 1,500 ")).toBe(1500);
    expect(parseFieldInput(n, "בערך 5000")).toBe("בערך 5000");
    expect(parseFieldInput(spec(), " דנה ")).toBe("דנה");
  });

  it("reports a cleared field as null so the key can be dropped", () => {
    expect(parseFieldInput(spec(), "   ")).toBeNull();
  });

  it("edits an answer a typed input cannot show as plain text instead", () => {
    // A number/date input blanks whatever it cannot parse, and the blank would
    // be saved back as "cleared" — losing the answer the lead actually gave.
    expect(fieldInputType(spec({ expect: "number" }), 5000)).toBe("number");
    expect(fieldInputType(spec({ expect: "number" }), "בערך 5000")).toBe("text");
    expect(fieldInputType(spec({ expect: "date" }), "2026-03-04T10:00:00.000Z")).toBe("date");
    expect(fieldInputType(spec({ expect: "date" }), "אחרי החגים")).toBe("text");
    // Empty is representable, so an unanswered question keeps its typed keypad.
    expect(fieldInputType(spec({ expect: "number" }), null)).toBe("number");
    // These two only flag a bad value, they never swallow it.
    expect(fieldInputType(spec({ expect: "email" }), "not-an-email")).toBe("email");
    expect(fieldInputType(spec({ expect: "phone" }), "050 בבית")).toBe("tel");
  });

  it("renders a value the form can round-trip, so an untouched field is unchanged", () => {
    // saveFieldsAction decides "did the agent touch this?" by comparing the
    // submitted text to fieldInputValue of the stored value — so these have to
    // agree, or merely pressing save would rewrite answers nobody edited.
    const d = spec({ expect: "date" });
    expect(fieldInputValue(d, "2026-03-04")).toBe("2026-03-04");
    expect(fieldInputValue(spec(), { nested: true })).toBe('{"nested":true}');
    expect(fieldInputValue(spec({ expect: "number" }), 1500)).toBe("1500");
  });

  it("suggests what other leads answered, deduped and without prose", () => {
    const rows = [
      { fields: { city: "חיפה", note: "x".repeat(80) } },
      { fields: { city: "ראש פינה" } },
      { fields: { city: "חיפה" } },
      { fields: null },
      { fields: { city: { nested: true } } },
    ];
    const got = suggestionsByField(rows, ["city", "note", "absent"]);
    expect(got.get("city")).toEqual(["חיפה", "ראש פינה"]);
    expect(got.get("note")).toEqual([]);
    expect(got.get("absent")).toEqual([]);
  });
});
