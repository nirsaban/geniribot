-- One Grow payment link for the whole platform, sold as a הוראת קבע.
--
-- Replaces the four per-plan × per-interval links (and the link-generation
-- flow that tagged them with an org id) with a single untagged hosted page.
-- Access length now comes from how many monthly payments the payer committed
-- to, so the MONTHLY/ANNUAL interval is replaced by a payments count.

-- ---------- Organization: four links -> one ----------
ALTER TABLE "Organization" ADD COLUMN "growPaymentUrl" TEXT;

UPDATE "Organization"
SET "growPaymentUrl" = COALESCE("growPaymentUrlProMonthly", "growPaymentUrlStarterMonthly")
WHERE "growPaymentUrlProMonthly" IS NOT NULL OR "growPaymentUrlStarterMonthly" IS NOT NULL;

ALTER TABLE "Organization"
  DROP COLUMN "growPaymentUrlStarterMonthly",
  DROP COLUMN "growPaymentUrlStarterAnnual",
  DROP COLUMN "growPaymentUrlProMonthly",
  DROP COLUMN "growPaymentUrlProAnnual";

-- The live link (GeniriBot: מנוי מתקדם / מנוי פרימיום, הוראת קבע up to 12 payments).
UPDATE "Organization"
SET "growPaymentUrl" = 'https://pay.grow.link/MTAzNTk4~ff8a7093f30cddeb71cb84e4cbdb003e-MzgxNzY5Nw'
WHERE "slug" = 'platform';

-- ---------- Money: the Grow products aren't whole shekels ----------
ALTER TABLE "PlanConfig" ALTER COLUMN "priceIls" TYPE DECIMAL(10,2);
ALTER TABLE "Subscription" ALTER COLUMN "priceIls" TYPE DECIMAL(10,2);
ALTER TABLE "Payment" ALTER COLUMN "amountIls" TYPE DECIMAL(10,2);
ALTER TABLE "UnclaimedGrowPayment" ALTER COLUMN "amountIls" TYPE DECIMAL(10,2);

-- ---------- Billing interval -> number of monthly payments ----------
ALTER TABLE "Subscription" ADD COLUMN "paymentsCount" INTEGER NOT NULL DEFAULT 1;
UPDATE "Subscription" SET "paymentsCount" = 12 WHERE "interval" = 'ANNUAL';
ALTER TABLE "Subscription" DROP COLUMN "interval";

ALTER TABLE "UnclaimedGrowPayment" ADD COLUMN "paymentsCount" INTEGER NOT NULL DEFAULT 1;
UPDATE "UnclaimedGrowPayment" SET "paymentsCount" = 12 WHERE "interval" = 'ANNUAL';
ALTER TABLE "UnclaimedGrowPayment" DROP COLUMN "interval";

DROP TYPE "BillingInterval";

-- ---------- Annual pricing is gone; monthly prices now mirror Grow ----------
ALTER TABLE "PlanConfig" DROP COLUMN "annualIls";
UPDATE "PlanConfig" SET "priceIls" = 0     WHERE "id" = 'FREE';
UPDATE "PlanConfig" SET "priceIls" = 49.56 WHERE "id" = 'STARTER';
UPDATE "PlanConfig" SET "priceIls" = 89    WHERE "id" = 'PRO';

-- ---------- Tie a charge back to its standing order ----------
ALTER TABLE "Payment" ADD COLUMN "growProcessId" TEXT;
