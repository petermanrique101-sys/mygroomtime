-- Migration: recurring_series_pause_and_appointment_reschedule_link
-- Chunk 17 adds the nightly materialization job. Series can be auto-paused (source client
-- or pet was soft-deleted) or transiently skipped (slot conflict on the day's run). We
-- track the pause cause for the operator log + retry counter for "no_available_slot" so
-- the job can give up cleanly after a week of failed attempts.

ALTER TABLE "RecurringSeries" ADD COLUMN "pausedAt"                       TIMESTAMP(3);
ALTER TABLE "RecurringSeries" ADD COLUMN "pauseReason"                    TEXT;
ALTER TABLE "RecurringSeries" ADD COLUMN "nextMaterializationAttemptAt"   TIMESTAMP(3);
ALTER TABLE "RecurringSeries" ADD COLUMN "consecutiveFailedMaterializations" INTEGER NOT NULL DEFAULT 0;

-- The nightly walk needs to pull (active=true AND nextDueDate <= now + 14d). The existing
-- (tenantId, active, nextDueDate) index isn't useful for this cross-tenant scan.
CREATE INDEX "RecurringSeries_active_nextDueDate_idx" ON "RecurringSeries"("active", "nextDueDate");

-- Public reschedule (chunk 17 customer-facing): when a customer uses a signed reschedule
-- link, we cancel the source appointment and create a fresh one inheriting client/pet/
-- snapshot/deposit. We record the link so an "already-used" token can return the new
-- appointment id back to the page.
ALTER TABLE "Appointment" ADD COLUMN "rescheduledFromAppointmentId" TEXT;
CREATE INDEX "Appointment_rescheduledFromAppointmentId_idx"
  ON "Appointment"("rescheduledFromAppointmentId");
