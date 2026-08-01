export * from "./plans.js";
export * from "./features.js";
export * from "./status.js";
export * from "./catalog.js";

/**
 * Fields Grow (Meshulam) POSTs to our notifyUrl callback (subset we use).
 * Form-encoded. The callback is unauthenticated — see
 * `apps/web/src/app/api/billing/grow/webhook/route.ts` for how we trust it
 * (by matching the charged sum to a known plan price).
 */
export interface GrowCallback {
  err?: string;
  transactionId?: string;
  transactionToken?: string;
  asmachta?: string;
  processId?: string;
  processToken?: string;
  sum?: string;
  paymentDate?: string;
  status?: string;
  statusCode?: string;
  cardSuffix?: string;
  cardBrand?: string;
  cardType?: string;
  transactionTypeId?: string;
  paymentType?: string;
  fullName?: string;
  payerPhone?: string;
  payerEmail?: string;
  invoiceUrl?: string;
  /** The saved-card token (from `saveCardToken: "1"`), if Grow's static page has that enabled. */
  cardToken?: string;
  cField1?: string; // organizationId
  cField2?: string; // plan
  cField3?: string; // interval
  [k: string]: string | undefined;
}
