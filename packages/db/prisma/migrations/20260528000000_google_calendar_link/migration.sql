-- AlterEnum
ALTER TYPE "WebhookSource" ADD VALUE IF NOT EXISTS 'google_calendar';

-- CreateTable
CREATE TABLE "GoogleCalendarLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleUserId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "googleCalendarId" TEXT NOT NULL DEFAULT 'primary',
    "encryptedRefreshToken" TEXT NOT NULL,
    "watchChannelId" TEXT,
    "watchResourceId" TEXT,
    "watchChannelToken" TEXT,
    "watchExpirationAt" TIMESTAMP(3),
    "lastSyncToken" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "needsReauth" BOOLEAN NOT NULL DEFAULT false,
    "consecutiveRenewFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarLink_userId_key" ON "GoogleCalendarLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarLink_watchChannelId_key" ON "GoogleCalendarLink"("watchChannelId");

-- CreateIndex
CREATE INDEX "GoogleCalendarLink_tenantId_idx" ON "GoogleCalendarLink"("tenantId");

-- CreateIndex
CREATE INDEX "GoogleCalendarLink_watchExpirationAt_idx" ON "GoogleCalendarLink"("watchExpirationAt");

-- AddForeignKey
ALTER TABLE "GoogleCalendarLink" ADD CONSTRAINT "GoogleCalendarLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarLink" ADD CONSTRAINT "GoogleCalendarLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
