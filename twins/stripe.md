# Twin: Stripe

A tiny HTTP server that speaks enough of Stripe's REST API + webhook delivery to let MyGroomTime's adapter run end-to-end without touching real Stripe.

## Endpoints to support

Subscription billing (platform side):
- `POST /v1/customers` — create customer, return `cus_TWIN_<n>`
- `POST /v1/checkout/sessions` — create a hosted-checkout session, return a URL that, when visited in a browser, auto-completes payment and fires the webhook
- `POST /v1/subscriptions` (rarely called directly; usually via Checkout)
- `POST /v1/subscriptions/:id` — update (for upgrade/downgrade proration)
- `DELETE /v1/subscriptions/:id` — cancel
- `GET /v1/subscriptions/:id`

Stripe Connect (tenant side):
- `POST /v1/accounts` — create connected account, return `acct_TWIN_<n>`
- `POST /v1/account_links` — create onboarding link that auto-completes
- `GET /v1/accounts/:id` — return capabilities (always `card_payments: active, transfers: active` for twin)

Payments (deposit + balance):
- `POST /v1/payment_intents` — create, return `pi_TWIN_<n>` with `client_secret`
- `POST /v1/payment_intents/:id/confirm` — confirm with a test card token
- `POST /v1/refunds` — issue refund

## Test card tokens

The twin recognizes these tokens by name, no card data needed:

| Token              | Behavior                                      |
|--------------------|-----------------------------------------------|
| `tok_visa_ok`      | succeeds                                      |
| `tok_visa_decline` | fails with `card_declined`                    |
| `tok_visa_insuf`   | fails with `insufficient_funds`               |
| `tok_visa_3ds`     | requires confirmation step, then succeeds     |
| `tok_visa_dispute` | succeeds, then fires `charge.dispute.created` webhook 5s later |

## Webhooks

When a payment_intent confirms, the twin POSTs the configured webhook URL with a signed event:

```
POST {webhook_url}
Stripe-Signature: t={ts},v1={hmac}
Body: { id: "evt_TWIN_<n>", type: "payment_intent.succeeded", data: { object: {...} } }
```

Signature uses `STRIPE_WEBHOOK_SECRET` (twin's value, set in env). The adapter must verify it the same way it verifies live Stripe — that's the whole point.

## Replay-on-demand

The twin exposes an admin endpoint for tests:

- `POST /__twin__/replay-event { event_id }` — re-delivers a past event. Use this in scenario 08 (webhook replay) without waiting for Stripe's actual retry timing.
- `POST /__twin__/simulate-delay { event_id, ms }` — delays delivery of a specific event by N ms. Use to test the "webhook arrives after the success page" path.

## State

The twin holds state in-memory by default (resets on restart). Optional `--persist <path>` flag to dump to JSON for cross-run debugging.

## What the twin does NOT do

- It does NOT verify card numbers or run any real fraud checks.
- It does NOT enforce Stripe's rate limits.
- It does NOT support every Stripe API — only the endpoints listed above. Adding a new endpoint is part of the chunk that needs it.
- It does NOT simulate Stripe's UI (Checkout, Connect onboarding). It returns URLs that auto-complete on visit — fine for tests, do NOT use for UX evaluation.
