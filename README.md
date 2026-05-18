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

### Scheduled SMS reminders in dev

Pro+ tenants can flip `/settings/sms` to send a 1-week heads-up, a 48-hour confirmation, a 2-hour ETA, and a day-after thank-you. Reminders are scheduled in BullMQ on Redis at appointment-create time (and again at materialization time for recurring instances), rescheduled on PATCH / removed on DELETE. They fire at the scheduled wall-clock time of the customer the appointment belongs to — no quiet-hours awareness in v1.

Seeding an appointment with reminders is just:

1. Promote a tenant to Pro: `UPDATE "Tenant" SET plan='pro', "smsRemindersEnabled"=true WHERE id='…'`.
2. Sign in as the owner → `/settings/sms` shows the toggle on.
3. Create an appointment via the calendar (or `POST /appointments`). Up to four BullMQ jobs land with deterministic ids: `reminder-7d.<appointmentId>`, `reminder-48h.<appointmentId>`, `reminder-2h.<appointmentId>`, `reminder-post.<appointmentId>`. The 7-day job is only enqueued if the appointment is >7 days out.

To exercise the worker without waiting hours, promote a delayed job so it runs immediately:

```bash
pnpm --filter @mygroomtime/api dev:fire-reminder <appointmentId> reminder-7d
```

The worker fires `app.adapters.twilio.sendSms`, which writes the usual audit row. Watch via `curl http://localhost:4243/__twin_messages`.

The 7-day reminder body invites a reply (`Reply C to confirm, R to reschedule`). Inbound replies are routed via the chunk-17 dispatcher (see "Recurring appointments" below).

Toggle-off is intentionally non-destructive: existing scheduled jobs stay in the queue and are skipped at fire time by the adapter's tier / opt-out checks. Toggling back on does not backfill reminders for existing future appointments — only newly created, rescheduled, or materialized appointments enqueue jobs.

### Recurring appointments (chunk 17)

When the owner taps "Complete" and rebooks in N weeks, a `RecurringSeries` row is created (or the matching existing one is reused). A nightly BullMQ job (`recurring-materialize` queue, fires at 02:00 UTC) walks every active series whose `nextDueDate ≤ now + 14d` and creates the next concrete `Appointment` — copying snapshot fields from the latest completed parent in the series (so future instances don't drift if the live `Service` is repriced or recolored).

Auto-pause cases (operator-visible in `RecurringSeries.pauseReason`):

- **`source_deleted`** — client or pet was soft-deleted between rebook and the next materialization. No retry; owner must explicitly resume.
- **`no_available_slot`** — `canPlaceAppointment` rejected the slot 7 nights in a row (owner has manually filled the calendar). The series pauses; nightly walk stops processing it.

To exercise the walker locally without waiting until 02:00 UTC:

```bash
pnpm --filter @mygroomtime/api dev:fire-materialization
```

That runs the walk in-process (bypassing BullMQ) and prints each series outcome. The 7-day reminder is enqueued for each successfully materialized appointment if `smsRemindersEnabled=true`.

**Pause / resume**: when an appointment is part of a recurring series, the calendar detail drawer shows a "Recurring" badge plus a "Pause series" or "Resume series" button (whichever state applies). Pausing only stops future materializations — it doesn't touch already-materialized future instances (those can be canceled individually).

**Inbound SMS dispatcher**: the chunk-17 webhook handler at `POST /webhooks/twilio` routes inbound replies priority-first:

1. `STOP` / `UNSUBSCRIBE` / `CANCEL` / `END` / `QUIT` → opt the customer out (chunk-14 behavior, unchanged).
2. Exact-trimmed `R`/`r` OR substring `RESCHEDULE` → mint a signed reschedule JWT and reply with the customer-facing URL `https://<slug>.<host>/public/reschedule/<token>`.
3. Exact `C` / `Y` / `YES` → log the confirmation and reply "Thanks! See you …".
4. `START` / `UNSTOP` → silent opt-in (no auto-reply).
5. Anything else → fallback "Sorry — we didn't catch that. Reply C to confirm, R to reschedule …".

The reschedule token is single-use (Redis-backed `jti`), expires at `appointment.scheduledStart + 6h`, and references the source appointment. The public reschedule page (`/public/reschedule/:token`) reuses the chunk-11 availability picker, lets the customer pick a new slot, and on commit cancels the old appointment + creates a new one inheriting the same `depositChargeId` (no new payment is taken) + same client/pet/snapshot. Reminders are removed from the old and enqueued for the new.

### Route optimization in dev

Pro+ tenants get a "Today's Route" tab on the calendar that orders the day's stops by nearest-neighbor from the configured depot. Single-vehicle in chunk 16; multi-vehicle dispatch lands in chunk 21.

To exercise it locally:

1. Promote a tenant to Pro and seed a depot:
   ```sql
   UPDATE "Tenant"
     SET plan='pro',
         "depotLat"=33.0198,
         "depotLng"=-96.6989
     WHERE id='…';
   ```
2. Sign in as the owner. Make sure the day has at least 2–3 clients with verified geocoded addresses (the geocode twin covers Plano / McKinney / Frisco zips).
3. Create a few appointments via the calendar for the same date.
4. Open the calendar → tap **Today's Route**.
5. Hit **Optimize route**. The API returns suggested order + drive times. Visual order is rendered as a schematic SVG (tile-rendered map planned for chunk 21).
6. Hit **Apply suggested times** to persist the reschedules. The chunk-15 reminder jobs are rescheduled to the new times automatically.

To pin a particular appointment to its slot (so the optimizer arranges other stops around it), check "Lock time" on the route row — that flips `Appointment.timeLocked=true` via `PATCH /appointments/:id`.

Starter tenants see an upgrade nudge instead of the Optimize button; the backend returns `403 { reason: 'tier_gated' }` on `GET /appointments/today/route` for them.

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

## Offline support in dev

Chunk 18 adds offline-tolerant scheduling. The web is a PWA: today's read surface
(appointments, buffers, services, /me) is cached with a 5-minute fresh window via a
service worker, and owner-side write endpoints flow through an IndexedDB-backed
mutation queue that replays on reconnect.

### Simulating offline

1. Open Chrome DevTools → **Application** → **Service Workers**. Check **Offline**
   (or use the Network panel's throttling dropdown → "Offline").
2. Drive the day view: mark appointments started, completed, etc. You'll see a
   neutral gray banner at the top: "Offline — N changes queued".
3. Tap **Pending** in the banner to inspect the queued mutations. Conflicts (4xx
   on replay) land in a "Needs attention" section with Discard.
4. Uncheck Offline. The queue drains in client-creation order (UUIDv7-sorted) and
   the banner fades through "Syncing — N left" → "All caught up".

### How the queue behaves

- Each write generates a client-side UUIDv7 sent as the `X-Mutation-Id` header.
- Online + 200/201 → normal flow.
- Online + 5xx / offline → enqueue locally, exponential backoff 1s/2s/4s/8s/16s
  for up to 5 attempts on replay, then conflict.
- 4xx on replay → straight to the conflict panel (no retry).
- Replays of an already-processed id return the original payload from the server
  without re-running the handler — Stripe charges, side-effects, etc. fire once.
- The queue survives app close/reopen via IndexedDB.

### Inspecting MutationLog

The api persists every owner-side mutation outcome to `MutationLog` (90-day
retention sweep lands in chunk 22). Open Prisma Studio to look at recent rows:

```bash
pnpm db:studio
```

…then browse the `MutationLog` table. Columns: id (the UUIDv7 the client sent),
status (`processed` | `failed`), statusCode, endpoint, resourceType, resourceId,
resultPayloadJson.

## Landing page

The static site at the repo root (`index.html` + `assets/` + `CNAME`) is served by GitHub Pages at [mygroomtime.com](https://mygroomtime.com). Edit those files directly to ship landing-page changes; no build step.
