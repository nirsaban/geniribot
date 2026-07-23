-- CreateTable
CREATE TABLE "MessageUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageUsage_organizationId_yearMonth_key" ON "MessageUsage"("organizationId", "yearMonth");

-- AddForeignKey
ALTER TABLE "MessageUsage" ADD CONSTRAINT "MessageUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
