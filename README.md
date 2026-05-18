# MyGroomTime

Scheduling and client-management SaaS for mobile dog groomers.

This repo holds two things:

- **The app** — `apps/`, `packages/`, `spec/`, `scenarios/`, `twins/`. The actual product.
- **The landing page** — `index.html`, `assets/`, `CNAME`. Static marketing site served at [mygroomtime.com](https://mygroomtime.com) via GitHub Pages.

## Getting started (app)

Prereqs:

- Node 22+
- pnpm 9+
- Docker Desktop **running** (the daemon must be up before `pnpm dev`)

```bash
pnpm i && pnpm dev
```

`pnpm preflight` checks the Docker daemon by itself if you want to verify before booting.

That brings up:

- Web → http://localhost:5173
- API → http://localhost:3000 (try `/healthz`)
- Postgres → localhost:5433 (avoids clashing with a native Postgres install on 5432)
- Redis → localhost:6379

Stop the local services with `pnpm docker:down`.

## Layout

```
apps/web        React + Vite PWA (groomer app + public booking page)
apps/api        Fastify HTTP API
packages/db     Prisma schema + client
packages/shared Zod schemas shared between web and api
twins/          External-service twins (deterministic stand-ins for Stripe, Twilio, Google Maps, Google Calendar)
spec/           Source-of-truth product + architecture + plan
scenarios/      Holdout behavioral tests (do not read during implementation)
index.html      Landing page (served at mygroomtime.com)
assets/         Landing-page brand assets
```

## Running twins

Each external integration ships with a "twin" — a separate process that speaks the same wire protocol as the real service but is deterministic, free, and safe in tests. The api picks live vs. twin per service via `<SERVICE>_MODE=live|twin`. In dev the default is `twin` for everything.

The twins aren't auto-started by `pnpm dev` — they'd be noise until you actually exercise one. Start the ones you need:

```bash
pnpm twin:gmaps       # Google Maps Distance Matrix on :4245
pnpm twin:geocode     # Google Geocoding on :4246
pnpm twin:stripe      # Stripe REST + webhooks on :4242
pnpm twin:twilio      # Twilio Messages API + inbound on :4243
```

Run each twin only when the feature you're touching uses that adapter in twin mode (the default). Address-creating flows (new client, public booking submit) need the geocode twin; routing/availability flows need the gmaps twin. Subscription billing (signup → Checkout) needs the Stripe twin. Anything that sends SMS (booking confirmation, future reminders) needs the Twilio twin.

The Stripe twin renders a hosted-checkout page that you can click through, or you can append `?auto=1` to the Checkout URL to complete + fire the webhook in one hop — handy for automated flows.

### SMS in dev

The Twilio twin (port 4243) accepts outbound sends at `/2010-04-01/Accounts/:sid/Messages.json` exactly like the real API and logs them in memory. Useful endpoints while iterating:

```bash
# Inspect what was "sent" in this session
curl http://localhost:4243/__twin_messages

# Simulate a customer texting STOP — fires a properly-signed POST to the api so the
# Twilio webhook handler runs end-to-end. The api will set Client.smsOptOut=true on
# any client whose phone matches (10-digit suffix) the From number.
curl -X POST http://localhost:4243/__twin_inbound \
  -H 'content-type: application/json' \
  -d '{"from":"+19725550199","body":"STOP"}'

# Clear twin state (sent + idempotency log).
curl -X POST http://localhost:4243/__twin_reset
```

Outbound SMS is **Pro+ only** — sends from a Starter / unpaid / past_due / canceled tenant short-circuit at the adapter to `{ sent: false, reason: 'tier_gated' }` and write an `SmsMessage` row with `status='skipped_tier'`. Same swallow-and-log for opted-out clients (`status='skipped_opt_out'`). No SMS reaches Twilio in those cases.

Every outbound body is auto-appended with " Reply STOP to opt out." and truncated to 160 chars if needed. The booking-confirmation handler passes the bare body; the adapter appends the suffix.

## Public booking pages in dev

The booking page lives at `<slug>.localhost:5173` (works natively in Chrome/Firefox without a hosts file). The tenant must be on the Pro or Business plan **and** Stripe Connect must be onboarded with `chargesEnabled=true` — otherwise the page renders with the Book button disabled.

### Public booking flow

1. Owner side, one-time: sign in → `/settings/payments` → "Set up payments". The Stripe twin returns an onboarding URL that auto-completes when visited; the browser lands back on `/settings/payments` with status "Active".
2. Customer side: visit `<slug>.localhost:5173` → pick a service → date → time → fill the customer + pet form → submit.
3. Submit creates a `BookingPageRequest` (status `pending_payment`) and a payment intent on the connected account. The web shows the Payment Element.
4. In twin mode, the Payment Element renders a stub "Pay" button (detected by the `pk_twin_` prefix on `VITE_STRIPE_PUBLISHABLE_KEY`). Click it → the backend confirms the PI on the twin → the twin fires `payment_intent.succeeded` to `/webhooks/stripe`.
5. The webhook handler promotes the `BookingPageRequest` to an `Appointment` (match-or-create on Client by phone, Pet by name+breed) and emails the customer (visible in the api logs since the email adapter is stdout in dev). The web's `/public/<slug>/booked/<requestId>` page polls the status endpoint and flips to "You're all set" within a second or two.

To exercise live Stripe.js, set `VITE_STRIPE_PUBLISHABLE_KEY` to a real `pk_test_` key — the web will render the real Payment Element instead of the twin stub. The Stripe twin can't itself accept real Stripe.js API calls; live keys are for testing against the real Stripe sandbox.

### Plan changes in dev

The owner-side flow lives at `/settings/billing`:

1. Click "Switch to <tier>" on any non-current tier card. The web calls `POST /settings/billing/preview-plan-change`, which proxies to the twin's `/v1/invoices/upcoming`, and renders the proration as "We'll charge $X today / We'll credit $X to your next invoice".
2. Click "Confirm switch to <tier>" → the api calls the twin's `POST /v1/subscriptions/:id` with `proration_behavior: create_prorations`. The twin updates the in-memory subscription and immediately fires `customer.subscription.updated` to `/webhooks/stripe`. The webhook handler maps `items[0].price.id` → tier, flips `Tenant.plan`, and writes a `TenantPlanChange` audit row.
3. The web polls `GET /settings/billing` every 2 s for up to 30 s; the card updates to the new tier within ~1 s in twin mode.

"Update card / Manage subscription" hits `POST /settings/billing/portal-session` → twin's `/v1/billing_portal/sessions`. The twin returns a hosted page with a "Back to app" link (or append `?auto=1` to redirect immediately). In live, Stripe's real Customer Portal opens.

Plan-change calls use a 5-minute-bucketed idempotency key (`tenant-<id>-<tier>-<bucket>`), so a double-click within the same window is one Stripe call and one webhook delivery.

## Landing page

The static site at the repo root (`index.html` + `assets/` + `CNAME`) is served by GitHub Pages at [mygroomtime.com](https://mygroomtime.com). Edit those files directly to ship landing-page changes; no build step.
