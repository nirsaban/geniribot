-- Raw Grow callback bodies, kept for diagnosis. With one untagged payment
-- link the callback IS the integration, and its exact field names for a
-- הוראת קבע can only be confirmed against a real delivery.
CREATE TABLE "GrowCallbackLog" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowCallbackLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GrowCallbackLog_createdAt_idx" ON "GrowCallbackLog"("createdAt");
