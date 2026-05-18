-- Migration: appointment_status_timestamps
-- Chunk 16.5 introduces full lifecycle transitions (on_the_way -> started -> completed,
-- plus no_show). Each transition records a wall-clock timestamp so chunk 19 can compute
-- "avg actual duration vs scheduled" and chunk 22 can surface a per-appointment audit log.
-- canceledAt already exists from chunk 8 -- not re-added here.

ALTER TABLE "Appointment" ADD COLUMN "onTheWayAt"  TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN "startedAt"   TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN "noShowAt"    TIMESTAMP(3);

-- For chunk 19 dashboard "completed appointments in last N days / month-to-date"
CREATE INDEX "Appointment_tenantId_completedAt_idx" ON "Appointment"("tenantId", "completedAt");
