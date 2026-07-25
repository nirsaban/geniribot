-- CreateTable
CREATE TABLE "PlanConfig" (
    "id" "Plan" NOT NULL,
    "priceIls" INTEGER NOT NULL,
    "annualIls" INTEGER NOT NULL,
    "connections" INTEGER NOT NULL,
    "contacts" INTEGER NOT NULL,
    "monthlyMessages" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanConfig_pkey" PRIMARY KEY ("id")
);
