-- Migration: sms_opt_out_and_messages
-- Chunk 14 brings SMS plumbing online for real. The init migration shipped a placeholder
-- SmsMessage schema (queued/sent/delivered/failed/undelivered, toPhone/fromPhone, no
-- idempotency key) optimistically. Nothing has written to that table yet — chunk 14 is
-- the first write site — so the enum is swapped out destructively and the columns are
-- renamed to E.164 to match the spec.
--
-- Adds Client.smsOptOutAt to record when STOP was received (smsOptOut flag already exists
-- from the init migration). Adds SmsMessage.idempotencyKey + sentAt + partial unique index
-- so the adapter can dedupe outbound sends per logical event without colliding with
-- inbound rows (which have idempotencyKey = NULL).

-- 1. Client.smsOptOutAt
ALTER TABLE "Client" ADD COLUMN "smsOptOutAt" TIMESTAMP(3);

-- 2. SmsStatus enum swap (queued/sent/delivered/failed/undelivered -> pending/sent/error/skipped_*).
ALTER TYPE "SmsStatus" RENAME TO "SmsStatus_old";
CREATE TYPE "SmsStatus" AS ENUM ('pending', 'sent', 'error', 'skipped_tier', 'skipped_opt_out');

ALTER TABLE "SmsMessage" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "SmsMessage"
  ALTER COLUMN "status" TYPE "SmsStatus"
  USING (
    CASE "status"::text
      WHEN 'queued' THEN 'pending'::"SmsStatus"
      WHEN 'sent' THEN 'sent'::"SmsStatus"
      WHEN 'delivered' THEN 'sent'::"SmsStatus"
      WHEN 'failed' THEN 'error'::"SmsStatus"
      WHEN 'undelivered' THEN 'error'::"SmsStatus"
      ELSE 'pending'::"SmsStatus"
    END
  );
ALTER TABLE "SmsMessage" ALTER COLUMN "status" SET DEFAULT 'pending';
DROP TYPE "SmsStatus_old";

-- 3. Rename phone columns to E.164.
ALTER TABLE "SmsMessage" RENAME COLUMN "toPhone" TO "toE164";
ALTER TABLE "SmsMessage" RENAME COLUMN "fromPhone" TO "fromE164";

-- 4. Add idempotencyKey + sentAt.
ALTER TABLE "SmsMessage" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "SmsMessage" ADD COLUMN "sentAt" TIMESTAMP(3);

-- 5. Tighten clientId FK from SetNull to Cascade — when a client is hard-deleted, their SMS
--    history goes with them. (Soft-delete via Client.deletedAt remains the normal path and
--    leaves SmsMessage rows in place.)
ALTER TABLE "SmsMessage" DROP CONSTRAINT "SmsMessage_clientId_fkey";
ALTER TABLE "SmsMessage"
  ADD CONSTRAINT "SmsMessage_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Partial unique index on idempotencyKey (outbound rows set it; inbound rows leave it
--    NULL). Postgres skips NULLs in unique indexes by default, so a plain unique works,
--    but a partial keeps the intent explicit and matches the schema.
CREATE UNIQUE INDEX "SmsMessage_idempotencyKey_key"
  ON "SmsMessage"("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- 7. Useful lookup for client-scoped SMS audit (operator log, chunk 22).
CREATE INDEX "SmsMessage_tenantId_clientId_idx" ON "SmsMessage"("tenantId", "clientId");
