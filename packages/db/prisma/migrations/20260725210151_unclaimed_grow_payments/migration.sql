-- CreateTable
CREATE TABLE "UnclaimedGrowPayment" (
    "id" TEXT NOT NULL,
    "growTransactionId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "amountIls" INTEGER NOT NULL,
    "payerPhone" TEXT,
    "payerEmail" TEXT,
    "cardSuffix" TEXT,
    "cardBrand" TEXT,
    "invoiceUrl" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "claimedByOrgId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnclaimedGrowPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnclaimedGrowPayment_growTransactionId_key" ON "UnclaimedGrowPayment"("growTransactionId");

-- CreateIndex
CREATE INDEX "UnclaimedGrowPayment_payerPhone_idx" ON "UnclaimedGrowPayment"("payerPhone");

-- CreateIndex
CREATE INDEX "UnclaimedGrowPayment_payerEmail_idx" ON "UnclaimedGrowPayment"("payerEmail");
