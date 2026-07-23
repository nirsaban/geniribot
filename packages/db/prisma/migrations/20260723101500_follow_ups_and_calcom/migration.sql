-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityKind" ADD VALUE 'APPOINTMENT_CANCELLED';
ALTER TYPE "ActivityKind" ADD VALUE 'FOLLOW_UP_SENT';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "calcomUid" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "followUpCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFollowUpAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "followUpAfterHours" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN     "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "followUpMax" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "followUpMessage" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_calcomUid_key" ON "Appointment"("calcomUid");

