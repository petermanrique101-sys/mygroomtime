-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "googleEventId" TEXT;

-- CreateIndex
CREATE INDEX "Appointment_googleEventId_idx" ON "Appointment"("googleEventId");
