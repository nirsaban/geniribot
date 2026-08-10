import { describe, expect, it } from "vitest";
import {
  growExternalId,
  growPayments,
  growPlan,
  isGrowSuccess,
  parseGrowCallback,
  VAT_RATE,
} from "./grow.js";
import { PLANS } from "./plans.js";

/** A realistic successful הוראת קבע delivery: 12 payments of the PRO product. */
const DIRECT_DEBIT: Record<string, string> = {
  "data[status]": "1",
  "data[statusCode]": "2",
  "data[sum]": "89",
  "data[paymentsNum]": "12",
  "data[paymentType]": "1",
  "data[description]": "מנוי פרימיום",
  "data[transactionId]": "tx-1",
  "data[asmachta]": "12345",
  "data[payerPhone]": "0501234567",
  "data[payerEmail]": "Payer@Example.COM",
  "data[cardSuffix]": "4242",
};

describe("parseGrowCallback", () => {
  it("unwraps Grow's data[...] nesting", () => {
    const cb = parseGrowCallback(DIRECT_DEBIT);
    expect(cb.sum).toBe("89");
    expect(cb.transactionId).toBe("tx-1");
    expect(cb.payerPhone).toBe("0501234567");
  });

  it("accepts bare keys too, in case Grow stops nesting", () => {
    expect(parseGrowCallback({ sum: "89", transactionId: "tx-2" }).sum).toBe("89");
  });

  it("finds the payments count under any of Grow's names for it", () => {
    for (const key of ["paymentsNum", "paymentNum", "payment_num", "numOfPayments"]) {
      expect(growPayments(parseGrowCallback({ [`data[${key}]`]: "6" }))).toBe(6);
    }
  });

  it("ignores empty values so a later alias still wins", () => {
    const cb = parseGrowCallback({ "data[paymentsNum]": "", "data[paymentNum]": "3" });
    expect(growPayments(cb)).toBe(3);
  });
});

describe("growPayments", () => {
  it("reads the committed number of monthly payments", () => {
    expect(growPayments(parseGrowCallback(DIRECT_DEBIT))).toBe(12);
  });

  it("falls back to a single month when absent or nonsense", () => {
    expect(growPayments(parseGrowCallback({}))).toBe(1);
    expect(growPayments(parseGrowCallback({ "data[paymentsNum]": "abc" }))).toBe(1);
    expect(growPayments(parseGrowCallback({ "data[paymentsNum]": "0" }))).toBe(1);
  });

  it("never grants more than the page can sell", () => {
    expect(growPayments(parseGrowCallback({ "data[paymentsNum]": "99" }))).toBe(12);
  });
});

describe("growPlan", () => {
  it("identifies the plan by the Grow product name", () => {
    expect(growPlan(parseGrowCallback(DIRECT_DEBIT))).toBe("PRO");
    expect(growPlan(parseGrowCallback({ ...DIRECT_DEBIT, "data[description]": "מנוי מתקדם" }))).toBe(
      "STARTER",
    );
  });

  it("matches a product name embedded in a longer description", () => {
    const cb = parseGrowCallback({ ...DIRECT_DEBIT, "data[description]": 'רכישת מנוי פרימיום x1 כולל מע"מ' });
    expect(growPlan(cb)).toBe("PRO");
  });

  it("falls back to the charged amount when there is no description", () => {
    const noDesc = { ...DIRECT_DEBIT };
    delete noDesc["data[description]"];
    expect(growPlan(parseGrowCallback({ ...noDesc, "data[sum]": "49.56" }))).toBe("STARTER");
    expect(growPlan(parseGrowCallback({ ...noDesc, "data[sum]": "89" }))).toBe("PRO");
  });

  it("still recognises the amount whichever side of VAT Grow reports", () => {
    const noDesc = { ...DIRECT_DEBIT };
    delete noDesc["data[description]"];
    const gross = (PLANS.STARTER.priceIls * (1 + VAT_RATE)).toFixed(2);
    expect(growPlan(parseGrowCallback({ ...noDesc, "data[sum]": gross }))).toBe("STARTER");
  });

  it("refuses to guess when nothing matches", () => {
    const noDesc = { ...DIRECT_DEBIT };
    delete noDesc["data[description]"];
    expect(growPlan(parseGrowCallback({ ...noDesc, "data[sum]": "17" }))).toBeNull();
  });

  it("honours super-admin price overrides in the amount fallback", () => {
    const catalog = { ...PLANS, PRO: { ...PLANS.PRO, priceIls: 150, growProductName: "" } };
    const cb = parseGrowCallback({ "data[sum]": "150" });
    expect(growPlan(cb, catalog)).toBe("PRO");
  });
});

describe("status + identity", () => {
  it("accepts Grow's several ways of saying success", () => {
    expect(isGrowSuccess(parseGrowCallback(DIRECT_DEBIT))).toBe(true);
    expect(isGrowSuccess(parseGrowCallback({ "data[status]": "success" }))).toBe(true);
    expect(isGrowSuccess(parseGrowCallback({ "data[status]": "0" }))).toBe(false);
  });

  it("prefers the transaction id but falls back to the asmachta", () => {
    expect(growExternalId(parseGrowCallback(DIRECT_DEBIT))).toBe("tx-1");
    const noTx = { ...DIRECT_DEBIT };
    delete noTx["data[transactionId]"];
    expect(growExternalId(parseGrowCallback(noTx))).toBe("12345");
    expect(growExternalId(parseGrowCallback({}))).toBeNull();
  });
});
