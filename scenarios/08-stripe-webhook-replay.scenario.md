# Scenario: Stripe redelivers a webhook — system handles it idempotently

**Persona:** System. (No human-facing UI in this scenario, but the failure mode is customer-hostile if it goes wrong.)

**Context:** A `payment_intent.succeeded` webhook fires when a dog owner pays a $20 deposit. The first delivery succeeds, the API records the deposit. Stripe redelivers the same webhook 24 hours later (this happens — Stripe will retry if it doesn't get a 2xx within timeout, or if the operator manually replays).

## Steps

1. Initial webhook arrives: `evt_1ABC...` with type `payment_intent.succeeded`.
2. API verifies the signature against `STRIPE_WEBHOOK_SECRET`. Valid.
3. API checks `WebhookEvent` table for this event id. Not found.
4. API inserts a `WebhookEvent` row with status=`processing` (using `INSERT ... ON CONFLICT DO NOTHING` to win the race against concurrent delivery).
5. API processes: marks the corresponding `BookingPageRequest` as paid, creates the `Appointment`, fires the SMS confirmation job.
6. API updates `WebhookEvent.status=processed`.
7. API returns 200.
8. Twelve hours later, Stripe (or an operator via the Stripe dashboard "resend") delivers `evt_1ABC...` again.
9. API verifies signature. Valid.
10. API checks `WebhookEvent` for this event id. Found, status=processed.
11. API returns 200 immediately without re-processing. No duplicate appointment. No duplicate SMS.

## Satisfaction criteria

- Signature verification is the **first** thing the handler does. Unsigned or invalid-signature webhooks return 400 and do not touch the database.
- The webhook event id is the deduplication key. The race condition (two concurrent deliveries) is closed via a database constraint (`UNIQUE` on `event_id`), not by an application-level check that has a TOCTOU gap.
- A redelivered webhook returns 200 without re-processing. Stripe sees 200 and stops retrying.
- No appointment is created twice. No SMS is sent twice. No Stripe Connect transfer is made twice.
- If processing fails (e.g., DB error mid-handler), `WebhookEvent.status=error` is written and the API returns 500. Stripe will retry. On retry, the handler sees status=error, re-attempts processing, and either succeeds (→ processed) or fails again (→ remains error).
- An error count is tracked. After 5 failed attempts on the same event, the event lands in an operator-visible dead-letter view with the raw payload preserved for manual investigation.
- The same idempotency pattern applies to all webhook handlers: `payment_intent.succeeded`, `charge.refunded`, `customer.subscription.updated`, `customer.subscription.deleted`, and Twilio's `MessageStatus` callbacks.
- Webhook payloads are stored raw (JSONB) for at least 30 days for debugging. After 30 days, only the event id and status are retained.
- The handler runs in <200ms p95 for the dedup path (already-processed event). Stripe will time out and retry if we take too long.
