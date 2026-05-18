-- Migration: sms_reminders_settings
-- Chunk 15 introduces scheduled SMS reminders (48h / 2h / post-appt) via BullMQ. The
-- tenant-level toggle defaults to false: existing tenants opt in explicitly so flipping
-- the global SMS infrastructure on doesn't silently start texting their existing book.
--
-- No new tables. BullMQ owns scheduling state in Redis; the SmsMessage table from chunk 14
-- remains the audit + idempotency source of truth at fire time.

ALTER TABLE "Tenant" ADD COLUMN "smsRemindersEnabled" BOOLEAN NOT NULL DEFAULT false;
