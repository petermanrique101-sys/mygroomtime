-- Migration: tenant_phone
-- Adds a public-facing business phone number to Tenant. Surfaced on the public booking
-- page (especially in the past_due read-only state, where the page asks customers to call).

ALTER TABLE "Tenant" ADD COLUMN "phone" TEXT;
