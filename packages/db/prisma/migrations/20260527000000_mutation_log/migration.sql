-- Migration: mutation_log
-- Chunk 18 layers a generic offline-replay dedupe table over the existing
-- Appointment.mutationUuid surface. Every owner-side write endpoint runs through a
-- middleware that records the request's client-generated UUIDv7 here and short-circuits
-- on replay. The retention sweep (chunk 22) deletes rows older than 90 days.

CREATE TYPE "MutationLogStatus" AS ENUM ('processed', 'failed');

CREATE TABLE "MutationLog" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "userId"            TEXT,
  "endpoint"          TEXT NOT NULL,
  "resourceType"      TEXT NOT NULL,
  "resourceId"        TEXT,
  "status"            "MutationLogStatus" NOT NULL,
  "statusCode"        INTEGER NOT NULL,
  "failureReason"     TEXT,
  "resultPayloadJson" JSONB,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MutationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MutationLog_tenantId_createdAt_idx"
  ON "MutationLog" ("tenantId", "createdAt");

CREATE INDEX "MutationLog_tenantId_resourceType_resourceId_idx"
  ON "MutationLog" ("tenantId", "resourceType", "resourceId");

ALTER TABLE "MutationLog"
  ADD CONSTRAINT "MutationLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MutationLog"
  ADD CONSTRAINT "MutationLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
