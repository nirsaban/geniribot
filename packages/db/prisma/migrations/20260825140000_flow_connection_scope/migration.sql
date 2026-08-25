-- Bind a scenario to one WhatsApp number. NULL = runs on all of the org's
-- numbers, which is what every pre-existing flow means, so no backfill.
ALTER TABLE "Flow" ADD COLUMN "connectionId" TEXT;

CREATE INDEX "Flow_connectionId_idx" ON "Flow"("connectionId");

-- SET NULL, not CASCADE: unpairing a number must not delete the scripts written
-- for it — they fall back to org-wide and stay editable.
ALTER TABLE "Flow"
  ADD CONSTRAINT "Flow_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
