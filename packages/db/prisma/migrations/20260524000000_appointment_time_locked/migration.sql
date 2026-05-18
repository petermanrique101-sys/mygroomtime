-- Migration: appointment_time_locked
-- Chunk 16 adds route optimization. The optimizer reorders a day's appointments
-- around `Tenant.depotLat/Lng`, but the owner sometimes needs a particular
-- appointment to stay in its slot (a vet drop-off window, a hard customer
-- preference, a multi-pet client where time was negotiated). `timeLocked`
-- pins those appointments — the optimizer anchors them in place and orders
-- the rest around them.
--
-- Default false so existing rows behave the same as today.

ALTER TABLE "Appointment" ADD COLUMN "timeLocked" BOOLEAN NOT NULL DEFAULT false;
