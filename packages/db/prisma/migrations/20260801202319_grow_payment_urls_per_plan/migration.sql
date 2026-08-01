-- AlterTable: add the 4 new per-plan link columns first (old column stays for now)
ALTER TABLE "Organization"
ADD COLUMN     "growPaymentUrlProAnnual" TEXT,
ADD COLUMN     "growPaymentUrlProMonthly" TEXT,
ADD COLUMN     "growPaymentUrlStarterAnnual" TEXT,
ADD COLUMN     "growPaymentUrlStarterMonthly" TEXT;

-- Backfill: carry the old single static link forward as the Starter/Monthly
-- link so checkout doesn't go dark the moment this ships. Best-effort only —
-- go to /admin afterward to fill in the other 3 links (and fix this one if
-- the old link wasn't actually priced for Starter/Monthly).
UPDATE "Organization" SET "growPaymentUrlStarterMonthly" = "growPaymentUrl" WHERE "growPaymentUrl" IS NOT NULL;

-- AlterTable: now drop the old column
ALTER TABLE "Organization" DROP COLUMN "growPaymentUrl";
