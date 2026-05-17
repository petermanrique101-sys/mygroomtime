# Twins — simulated external services

Each external service has both a "live" adapter (talks to the real SDK) and a "twin" — a process that speaks the same wire protocol as the real service but is deterministic, free, and safe to run in tests and dev.

The `apps/api` code talks to an adapter interface and doesn't know which is connected. Picking is one env var: `STRIPE_MODE=live|twin`, `TWILIO_MODE=live|twin`, etc.

## Why twins (not just mocks at the adapter boundary)

- Scenarios run against the live system end-to-end. A mock at the adapter line hides real bugs in the adapter itself (request shape wrong, header missing, retry logic broken).
- Twins are reusable across dev, CI, and scenario eval — one implementation, three contexts.
- They cost zero per call, can simulate failure modes on demand (decline a card, rate-limit an SMS, return a webhook delay), and never touch a real customer.

## Layout

```
twins/
  stripe.md           ← contract
  stripe/             ← implementation (added during build, not part of spec)
  twilio.md
  twilio/
  google-calendar.md
  google-calendar/
  google-maps.md
  google-maps/
```

The `.md` files are the spec — what the twin must do. Implementations live in sibling folders and are built as part of the relevant chunks in `spec/plan.md`.

## Twin selection rule

For each external service:

| Service          | Why we twin it                                                |
|------------------|----------------------------------------------------------------|
| Stripe           | Real money, real Connect transfers. Need to simulate declines, refunds, webhook replays without spending. |
| Twilio           | Real SMS costs money + actual phones. Need to simulate inbound STOP / R / C replies and delivery failures. |
| Google Calendar  | OAuth flow + side-effects on real calendars. Twin avoids polluting real accounts during dev/test. |
| Google Maps      | Rate-limited, costs per request. Distance Matrix is the only call we make; trivial to twin with deterministic distance math. |

## What good looks like

A twin passes if:
- The api code can switch `MODE=live` → `MODE=twin` with no code change, only env.
- All scenarios in `scenarios/` pass against the twin.
- A spot-check run against the real service (with a dev key) for one scenario succeeds — confirming the adapter and the twin both match reality.
