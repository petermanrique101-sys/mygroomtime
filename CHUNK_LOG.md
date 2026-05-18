# Chunk Log — MyGroomTime

Running log of what's landed, what was decided, and what to know going forward. Read this **after** `spec/plan.md` to catch up on cross-chunk context that isn't captured in the spec files themselves.

---

## How to use this file

You're either Claude continuing the build, or a human picking up the project.

If you're Claude:
1. Read `spec/constitution.md`, `spec/architecture.md`, `spec/product.md`, `spec/plan.md` first.
2. Read this file end-to-end. It captures decisions that were made between chunks in chat and locked into prompts — they bind even where the spec hasn't been backfilled yet.
3. Read `NEXT_CHUNK.md` for the next ready-to-go chunk prompt.
4. Hand the chunk prompt to a fresh agent session. The agent reads `spec/` (+ the one allowed `twins/<svc>.md` if its chunk builds that twin) and writes code. You evaluate the recap.

Process discipline:
- Verify each chunk's recap yourself: `pnpm typecheck && pnpm lint && pnpm test`. Don't trust "all green" claims — chunk 10's agent claimed green when lint was actually failing.
- Commit immediately after a passing recap. One commit per chunk. Use the chunk number in the message.
- "Hold for eval" is a hard line — the agent should not do unsolicited cleanup or start the next chunk. If it drifts, stop it and triage with `git status`.
- Pre-flight cleanups happen as their own discrete step **before** the next chunk's prompt is sent. Don't bundle.

---

## Where we are

| Chunk | Title | Status |
|-------|-------|--------|
| 1 | Monorepo scaffold + tooling | ✅ done, committed |
| 2 | Multi-tenant data model + Prisma schema | ✅ done, committed |
| 3 | Auth (email/password + magic link + sessions) | ✅ done, committed |
| 4 | Adapter scaffolding (stripe/twilio/gcal/gmaps) | ✅ done, committed |
| 5 | Twin: Google Maps + adapter | ✅ done, committed |
| 6 | Clients + Pets CRUD + geocode twin/adapter | ✅ done, committed |
| 7 | Services CRUD + color palette | ✅ done, committed |
| 8 | Calendar shell (day/week/month, tap-to-create) | ✅ done, committed |
| 9 | Drag-to-reschedule + drive-time blackout windows | ✅ done, committed |
| 10 | Stripe twin + adapter + subscription billing + webhooks | ✅ done, committed |
| 11 | Public booking page (read-only) with subdomain routing | ✅ done, committed |
| 12 | Public booking submit + Stripe Connect deposit | ✅ done, committed |
| 13 | Tier upgrade/downgrade + Stripe Customer Portal | ✅ done, committed |
| 14 | Twin: Twilio + adapter + outbound SMS + booking confirmation SMS | ✅ done, committed |
| 15 | Scheduled SMS jobs (48h, 2h, post-appt) via BullMQ | ✅ done, committed |
| **16** | **Route optimization + day route view** | **← next, prompt in `NEXT_CHUNK.md`** |
| 17 | Recurring appointments | pending |
| 18 | Offline support (PWA, mutation queue) | pending |
| 19 | Owner dashboard | pending |
| 20 | Twin: Google Calendar + two-way sync (Pro+) | pending |
| 21 | Business tier: multi-vehicle dispatch + payroll splits | pending |
| 22 | Operator log + admin polish + production readiness | pending |

---

## Cross-chunk policy decisions (not all in spec yet)

These were locked in via chunk prompts. Honor them in future chunks.

### Plan state machine (chunk 10)
Plan enum: `unpaid | starter | pro | business | past_due | canceled`.
- New tenants default to `unpaid`. `/signup/billing` is the only authed route reachable until paid.
- `requirePaidPlan` middleware blocks `unpaid`, `past_due` (write-restricted), `canceled` from non-billing routes.
- `past_due`: GET passes, POST/PATCH/DELETE return 403 with `reason: 'past_due'`. App enters read-only mode.
- `canceled`: only `/me`, `/billing`, `/logout` accessible.
- Webhook cascade: `invoice.payment_failed` sets `pastDueAt` (banner only) → `subscription.updated` with status=past_due flips plan → `subscription.deleted` flips to canceled.
- **Never auto-downgrade tier on payment failure.** Failed $149 → free $49 would be a perverse incentive.
- No trial. Pay on signup. (Scenario 01's "Start free trial" copy is wrong; update the scenario file later, not the product.)

### Tier capabilities (chunk 11)
- **Starter** ($49): no public booking page. Calendar + clients only.
- **Pro** ($99): public booking page enabled, route optimization, recurring, GCal sync.
- **Business** ($149): + multi-vehicle dispatch + payroll splits.
- Public booking page: `starter`/`unpaid`/`canceled` → 404; `past_due` → render with disabled Book button; `pro`/`business` → normal.

### Scheduled SMS reminders + BullMQ (chunk 15)
- **No retroactive scheduling.** Enabling the tenant's `smsRemindersEnabled` toggle does NOT walk existing future appointments. Same for tier upgrades from Starter to Pro. Reason: silent SMS spam on toggle-on is worse than missing the immediate next-day reminder. If a customer needs the reminder for an upcoming appointment, the operator can manually nudge.
- **Reschedule is `remove + add`, never upsert.** BullMQ's `Queue.add(name, data, { jobId })` is a no-op on jobId collision — leaving the OLD `delay` in place. Always call `removeAppointmentReminders` first, then `enqueueAppointmentReminders` with fresh data.
- **Cancel/delete removes pending jobs. Already-sent SmsMessage rows stay** (audit trail).
- **Worker lives in the api process for v1.** `createApp` constructs queue + worker (skipped when `nodeEnv==='test'` unless `reminderInfra` is explicitly passed). `onClose` shuts them down. Tests that exercise reminders pass `makeTestReminderInfra()` against the real dev Redis; tests that don't are inert.
- **Fire-time policy is defense in depth.** Worker re-fetches appointment + tenant + client. If canceled/no_show/deleted → success-return, no retry. The Twilio adapter already enforces tier gate + opt-out + idempotency at the wire — worker doesn't replay those rules, just calls `sendSms` and reads the result.
- **Tight-window skips at enqueue.** `<48h` to start → skip the 48h job, enqueue the 2h + post. `<2h` → skip both reminders, still enqueue post. `<0h` post-appt window → log + skip (defensive — impossible in normal flow).
- **Worker retries** = BullMQ default exponential backoff, max 5 attempts. After 5: BullMQ `failed` state. SmsMessage row owns the eventual send outcome (success or `error`).
- **Job ID separator is `.` not `:`** — BullMQ rejects `:` in custom job IDs. Format: `reminder-{kind}.{appointmentId}`. Documented inline in `queue-names.ts`.
- **Reminder copy lives in one file** (`reminder-templates.ts`). Date format is shared with email + booking-confirmation SMS via `services/format-datetime.ts` — "Wednesday, May 20 at 10:00 AM". Single source.
- **Toggle-OFF is zero-work.** Existing scheduled jobs are NOT removed. At fire time, the worker still runs but the adapter records `skipped_tier` (if the tenant downgraded) or sends normally (if the toggle was just turned off — defense-in-depth gap to fix in chunk 22 if it becomes a real issue, but for v1 the toggle is rare enough that no walk is fine).
- **Post-appointment review SMS has no URL v1.** Body is just "Thanks for trusting {tenantName} with {petName}. We'd love your feedback!" Chunk 21 (business tier polish) adds `Tenant.reviewUrl`.

### Outbound SMS + opt-out (chunk 14)
- **Adapter is the enforcement boundary.** Tier gate (Pro+), opt-out lookup, idempotency dedupe, mandatory "Reply STOP to opt out." suffix, and 160-char truncation all live in `apps/api/src/adapters/twilio/compose.ts`. Call sites just call `sendSms(...)` and read the result; they never enforce the rules themselves.
- **`SmsMessage` is the application-level idempotency truth.** Outbound rows get an idempotency key; the adapter pre-flight queries the table for `pending`/`sent` rows with the same key and short-circuits before any Twilio call. The twin also dedupes by `(From, To, Body)` within a 60s window as a wire-level safety net.
- **STOP/START keyword sets are locked**: STOP set = `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT`; START set = `START, UNSTOP, YES`. Case-insensitive on a trimmed body. These match Twilio's canonical handling.
- **Inbound webhook signature verified FIRST.** `X-Twilio-Signature` = base64 HMAC-SHA1 of `URL + sorted ${key}${value} concat` (no separator). Invalid → 400 + bail, no DB touch. Replay-safe via chunk-10 `UNIQUE(source, eventId)` on the MessageSid.
- **No retries on send failure in v1.** Log it, record `SmsMessage.status='error'`, move on. Chunk 22's operator log will surface failures.
- **Single platform from-number for v1.** Per-tenant numbers / Messaging Service routing is v2 / chunk 21+.
- **STOP suffix is mandatory** on every outbound. The adapter appends; callers pass the bare body. Truncation (>160 with suffix) drops to `…` before the suffix and emits a warn-level log for chunk 22's surfacing.
- **Tier-gated and opt-out sends are NOT errors** — they're recorded as `SmsMessage(status='skipped_tier'|'skipped_opt_out')` and the adapter returns `{ sent: false, reason }`. Future chunks (15 reminders, 21+) just check `sent: true` and don't have to repeat the policy.
- **Phone helper is canonical**: `apps/api/src/services/phone.ts` exports `normalizePhone`, `tenDigitSuffix`, `suffixesMatch`, `toDialFormat`. Chunk 12's inline normalize is gone — anyone matching by phone should import these. International numbers are still 10-digit-suffix for v1; libphonenumber upgrade flagged in `phone.ts` for v2.

### Tier upgrade/downgrade + proration (chunk 13)
- **Tier flip is webhook-canonical, not route-canonical.** `POST /settings/billing/change-plan` returns 202 + `{ pending: true, willTakeEffect: 'webhook' }`. The actual `Tenant.plan` mutation lives in the `customer.subscription.updated` handler. Web polls `GET /settings/billing` every 2s after confirm until the plan flips.
- **Proration is shown before confirm.** Two-step UX: `POST /settings/billing/preview-plan-change` calls Stripe's upcoming-invoice endpoint, returns `{ amountDueCents, creditCents, chargeCents, nextChargeCents, currentPeriodEndIso }`. Modal renders "Today: $X. Then: $Y/mo starting on <date>." Customer can read it and back out.
- **Downgrade is non-destructive.** No existing data is touched. Locked as comments in the plan-state code:
  - Future-dated appointments stay (the grooming was paid for).
  - Recurring series (chunk 17) finish naturally; new ones are blocked once `plan='starter'`.
  - Pending `BookingPageRequest` rows expire normally; no refund flow on downgrade.
  - The public booking page just 404s for new submits via chunk-11's tier gate.
- **Block plan changes when `Tenant.plan` is `past_due` / `canceled` / `unpaid`.** They must resolve billing first via chunk-10 flows.
- **No-op plan changes (same tier → same tier) reject at 400.** Don't roundtrip Stripe.
- **Customer Portal is a separate concern.** Portal handles card updates + cancel-at-period-end. Tier moves use our own change-plan route because we want to own the proration preview UX. Portal *can* do tier changes too, but we don't route customers there for that.
- **`Tenant.stripeSubscriptionItemId`** added in `20260518000000_tenant_subscription_item_and_plan_history`. `subscriptions.update` wants the item id, not just the price id, so we cache it. Backfill at signup (already wired for new tenants); the migration includes a one-time pull for existing rows.
- **`TenantPlanChange` audit table** records every tier flip with `fromPlan`, `toPlan`, `prorationAmountCents`, `createdAt`. Chunk 22 (operator log) will surface this.

### Stripe Connect + public booking submit (chunk 12)
- Connect onboarding is **lazy** — first visit to `/settings/payments` creates the connected account. Don't bake this into signup.
- Public booking submit requires `Tenant.stripeConnectChargesEnabled=true`. If false: booking page renders services but **disables Book** (chunk-11 `past_due` rendering pattern). Submit endpoint returns `409 payments_not_ready`.
- `BookingPageRequest` is the staging row created at submit. **Promoted to `Appointment` by the `payment_intent.succeeded` webhook handler**, not by the submit route. The confirmation page polls status independently — if `payment_intent` is `succeeded` it shows "Booked!" even before the appointment row exists.
- **Idempotency**: submit reuses an existing pending `BookingPageRequest` keyed on `{serviceId, requestedStart, ownerPhone}`. `bookingRequestId` is passed as Stripe idempotency-key on payment intent creation.
- **Match-or-create Client**: 10-digit phone-suffix comparison. `Client.phone` stays as entered (not normalized). International rollout will require libphonenumber — flagged in `payment-intent-succeeded.ts`.
- **Geocode at submit**: real customer address geocoded inline; `ZERO_RESULTS` → 400 with friendly copy, no DB writes. Slot re-validated with **real customer coords** via `canPlaceAppointment` — chunk-11's depot-coord placeholder is no longer load-bearing at submit time.
- **Expiry**: lazy. `pending_payment` rows past 30-min TTL flip to `expired` in `availability.ts` (before computing candidates) and in `booking-status.ts` (per-row on poll). No scheduled sweeper until chunk 17+.
- **Application fee = 0** in v1. Direct charge on connected account via `transfer_data[destination]` + `on_behalf_of`. `// TODO v2: monetize Connect` marker in adapter. Don't change this without a product decision.
- **Email confirmation**: stdout adapter only (chunk 22 swaps to SES). **SMS confirmation marker** `// chunk 14: enqueue SMS confirmation` in `payment-intent-succeeded.ts` — chunk 14 wires twilio.
- **Twin Stripe.js stub**: real `loadStripe()` only talks to js.stripe.com. Web detects `pk_twin_` publishable key and renders a stub Payment Element that hits `/public/:slug/bookings/:id/twin-confirm`. Live mode keeps real Payment Element + Stripe sandbox. The twin-confirm route 404s in live mode.

### Subdomain routing (chunk 11)
Local dev: `<slug>.localhost:5173` works natively in Chrome/Firefox.
- `localhost` (1 part) → groomer app
- `slug.localhost` (2 parts) → public booking page for that tenant
- Reserved leftmost labels (`app`, `www`, `api`) → always groomer app, never treated as a slug
- `mygroomtime.com` (apex) → groomer app
- `slug.mygroomtime.com` (3 parts) → public booking page

The API never sees the subdomain; the web parses `hostname` on boot and translates to `/public/:slug/` paths.

### Multi-tenancy enforcement (chunk 2)
- Every non-global table has `tenantId` indexed + FK to Tenant with `onDelete: Cascade`.
- All tenant-scoped DB access goes through `db.forTenant(tenantId)` from `packages/db`. Direct `prisma.X.findMany()` outside `packages/db/` is **lint-blocked** (ESLint `no-restricted-imports`).
- Globals (`Tenant` itself, `WebhookEvent`) accessed via `db.global`.
- `WebhookEvent` is intentionally **global**, not tenant-scoped — Stripe/Twilio event ids are globally unique, and we sometimes dedupe before knowing the tenant.

### Money + currency
- All amounts stored and transmitted as **integer cents**. No Decimal, no float.
- Currency: USD only v1 (per spec out-of-scope).
- Conversion helpers live in `apps/web/src/routes/settings/money.tsx` (web) and inline in api code where used.

### Service drift handling (chunk 8)
Appointment carries **snapshot columns** populated at create time:
- `serviceNameSnapshot`, `servicePriceCentsSnapshot`, `serviceDepositCentsSnapshot`, `serviceColorSnapshot`, `serviceDurationMinSnapshot`.

Why: when an owner reprices Full Groom $85→$95 or soft-deletes it, existing appointments still render with the booked values. The `serviceId` FK is preserved for analytics; display/billing reads from the snapshot.

### Address override on appointments (chunk 8)
Appointment has nullable `addressOverride*` columns. If set, used instead of Client's address. Default behavior is to use Client's address. Customer cases: vacation home, daycare pickup.

### Drive-time blackouts (chunk 9)
Buffer between consecutive appointments computed from real drive time via gmaps adapter. Falls back to `Tenant.defaultBufferMinutes` (default 15) when:
- First or last appointment of the day
- Either endpoint lacks coordinates (unverified client + no override coords)
- gmaps adapter errors

Drag-to-reschedule: 15-min snap grid. Custom pointer events (not react-dnd, not native HTML5 DnD — both don't work right on touch). Drag into past = blocked, no override.

### Webhook dedupe pattern (chunk 10)
Database `UNIQUE(source, eventId)` constraint is the race-stopper, not an app-level check. Handler:
1. Signature verify first (Stripe / Twilio HMAC). Invalid → 400 + bail, no DB touch.
2. `INSERT ... ON CONFLICT DO NOTHING` on WebhookEvent — if affected_rows=0, already processed → return 200 immediately.
3. Else process + update status. On error, set status=`error`, return 500. Retries are handled by the source.
4. 5+ failures land in dead-letter (operator log surfaces in chunk 22).

### Address geocoding (chunk 6)
- Geocode runs on client create/update **only if address fields changed** (don't re-hit adapter on notes/name change).
- `ZERO_RESULTS` → save with `addressVerified=false` + warning in response (don't 4xx).
- `REQUEST_DENIED` / network errors → 502 with actionable message.
- Geocode twin handles Plano/McKinney/Frisco zips deterministically; unknown zip → ZERO_RESULTS.

### Soft-delete pattern
Applies to `Client`, `Pet`, `Service`. `deletedAt DateTime?` + index. All read paths filter `deletedAt: null`. Client soft-delete cascades to its pets.

**Future:** chunk 12 (or whenever appointments touch soft-delete) should **block** soft-deleting a Client if future scheduled appointments exist — return 409 with the count + hint "Cancel N upcoming appointments first". Force users through the cancel flow so refund decisions get made explicitly.

### User uniqueness (chunk 3, pre-flight reversal)
Originally `@@unique([tenantId, email])` (chunk 2 — multi-tenant email reuse). **Reversed in chunk 3 pre-flight to global `@unique` on `User.email`.** Reason: login-by-email needs global uniqueness; the per-tenant unique + runtime pre-check at signup was a TOCTOU race. Multi-business owners can use `email+suffix@` if it ever comes up for real.

### Slug auto-collision (chunk 3)
Signup slug is auto-generated from business name. On collision: `-2`, `-3`, ... appended. Long-term plan: let users pick their slug in the chunk 22 onboarding wizard.

### Default vehicle (chunk 8)
Tenants don't get a Vehicle on signup. `ensureDefaultVehicle(tenantId)` lazy-creates "Van 1" on first appointment create. Seed materializes it explicitly. Multi-vehicle UX is chunk 21.

---

## Chunk recaps (essentials)

### Chunk 1 — scaffold
- Monorepo: `pnpm-workspace.yaml` covering `apps/*`, `packages/*`, `twins/*` (workspace added in chunk 5).
- `apps/web` (Vite+React+TS+Tailwind), `apps/api` (Fastify+TS), `packages/db` (Prisma init, throwaway Health model removed in chunk 2), `packages/shared` (Zod).
- Turbo for orchestration. Vitest wired root + workspaces.
- Docker Compose for Postgres + Redis. **Postgres on 5433** to avoid clashing with user's native PG on 5432.
- `scripts/preflight.mjs` runs `docker info` and chains into `pnpm dev` so missing daemon fails fast with "Start Docker Desktop and retry."

### Chunk 2 — schema
- 11 models, 10 enums.
- All non-global tables: `tenantId` + index + cascade FK.
- `Appointment.mutationUuid @unique` added pre-emptively for chunk 18 offline replay dedup.
- Wrapper: `packages/db/src/scope.ts` (runtime injection) + `types.ts` (per-model `ScopedXxx` types stripping tenantId) + `client.ts` (composes `db.forTenant` + `db.global`).
- Seed: idempotent, demo tenant with 5 clients, 8 pets, 3 services.

### Chunk 3 — auth
- Email/password (argon2id, OWASP params), session cookie (Redis-backed, sliding 14d), magic link (jose JWT, Redis jti, single-use, 15min TTL).
- Email adapter scaffold with stdout impl for dev (SES is chunk 22).
- Pre-flight reversal: `User.email` to global unique (see policy section above).

### Chunk 4 — adapter scaffolding
- Folders for `stripe`, `twilio`, `gcal`, `gmaps` with `{index, types, live, twin}.ts` each.
- All methods throw "not implemented" until their chunk lands.
- `createAdapters(env)` composes everything into a single `fastify.adapters` bag.

### Chunk 5 — gmaps twin + adapter
- Twin: Fastify server on :4245, deterministic distance via haversine + 35 km/h + 60s stop overhead. Failure modes triggered by lat=0.0, -1.0, -2.0.
- Adapter parse.ts shared between live + twin.
- Integration test boots twin in-process on ephemeral port and asserts twin/adapter agree.
- `GmapsElementStatus` union expanded from chunk-4 minimal set (added OVER_DAILY_LIMIT, OVER_QUERY_LIMIT, REQUEST_DENIED, INVALID_REQUEST, UNKNOWN_ERROR).

### Chunk 6 — clients + pets + geocode twin
- New twin: `twins/geocode` on :4246 (geocoding was originally going to be punted; reversed because scenarios 01/02 take address strings).
- Geocode adapter mirrors gmaps shape exactly.
- Soft-delete via `deletedAt`. Client soft-delete cascades to pets.
- `addressVerified` flag — `ZERO_RESULTS` → save with `false` + UX banner ("Edit and save to retry").
- Added `Client.addressState` with TX default (chunk-2 spec gap — state field was missing from the schema entirely).

### Chunk 7 — services
- Settings page at `/settings/services`. Inline view-swap (no modal lib).
- 12-color palette in `packages/shared/src/colors.ts`. Calendar imports the same constant.
- `depositCents ≤ basePriceCents` validation server-side.
- Active toggle + soft-delete + restore.

### Chunk 8 — calendar shell
- Day (default on phone) / week / month views. 15-min snap grid, 30-min label rows.
- Snapshot columns added to Appointment (the chunk-2 gap — see policy).
- Address override columns added.
- `Appointment.canceledAt` added (parity with Client/Pet/Service soft-cancel).
- Seed extended with 3 sample appointments.

### Chunk 9 — drag + buffers
- Pre-flight that landed inside this chunk: `Tenant.defaultBufferMinutes Int @default(15)`.
- Custom pointer events (not react-dnd, not HTML5 DnD).
- `canPlaceAppointment` consolidated overlap + buffer + past checks.
- Gmaps batched into one `distanceMatrix` call per day-view buffers fetch.
- Live ghost during drag; hard 409+revert as race-condition safety net.
- Known minor caveat: snap stutter at 15-min boundaries on slow finger drags. Defer fix.

### Chunk 10 — Stripe billing
- Stripe twin on :4242. Webhook signature matches real Stripe (HMAC-SHA256 with timestamp).
- Adapter: subscription methods implemented in live; Connect methods + payment intents stay throwing in live (chunk 12 fills).
- Webhook dedupe race tested under `Promise.all([signedPost, signedPost])` — exactly-one effect verified.
- `requirePaidPlan` applied to all chunks 6/7/8/9 routes. Exempt: `/me`, `/auth/*`, `/billing*`, `/webhooks/*`, `/healthz`, `/probe/*`.
- Twin contract gap noted: Customer Portal endpoint will be needed in chunk 13.
- Post-recap drift: agent kept working after "Holding for eval" and chased lint errors. The fixes were real (recap "all green" was wrong), but the pattern was bad. Process lesson: verify recaps; commit before unblocking.

### Chunk 11 — public booking (read-only)
- Subdomain detection in `apps/web/src/lib/subdomain.ts` with reserved-label handling.
- Public routes mounted only when subdomain detection says "public" — clean isolation from groomer app guards.
- `resolve-public-tenant` middleware enforces plan-tier visibility (see policy).
- Availability service iterates 15-min candidates per service, calls `canPlaceAppointment` per slot. Uses **tenant depot coords as the placeholder** for buffer math since customer address isn't collected until chunk 12. Documented in `availability.ts:50`.
- 60 req/min rate limit per IP per slug on public endpoints.
- `Tenant.phone` added in migration.
- 13 new api tests, 10 subdomain tests, 5 public web tests. 117 api tests total.

### Chunk 15 — Scheduled SMS reminders via BullMQ
- Queue + Worker factories in `apps/api/src/queue/`. Single source for queue name + job names + `reminderJobId(name, appointmentId)` helper using `.` separator (BullMQ rejects `:` in custom IDs).
- Lifecycle helpers in `apps/api/src/services/reminder-schedule.ts`: `computeReminderTimestamps`, `enqueueAppointmentReminders`, `removeAppointmentReminders`, `rescheduleAppointmentReminders`. Tight-window appointments return nulls for impossible kinds. Reschedule = explicit remove + add.
- Appointment route hooks: `create.ts`, `update.ts` (reschedule on start change only), `delete.ts`. `payment-intent-succeeded.ts` enqueues on webhook promote.
- Worker handler (`reminder-worker.ts`): re-fetches appointment + tenant + client at fire time; returns success on missing/canceled/no_show/opted-out/tier-gated/send-failure-business-outcome; throws only on infra errors so BullMQ retries (5x exp backoff).
- App wiring: `createApp` constructs queue + worker (skipped when `nodeEnv==='test'` unless `reminderInfra` is overridden). `onClose` shuts down worker → queue → redis. `CreateAppOptions.reminderInfra` lets tests pass `makeTestReminderInfra()` against dev Redis when needed.
- Schema: `20260522000000_sms_reminders_settings` adds `Tenant.smsRemindersEnabled Boolean @default(false)`. Opt-in — tenants must enable explicitly.
- Settings: `GET/POST /settings/sms` + `apps/web/src/routes/settings/sms.tsx`. Starter gets 403 on enable + "Upgrade to Pro" copy.
- Boundary tested: 47h59m before start returns `fortyEightH: null` (start - 48h is in the past). Exact-48h also returns null (`>` not `>=`) — a job firing with 0 delay would be useless.
- "No ghost jobs after reschedule" test enqueues for start = +5d, captures 48h delay, PATCHes start to +24h later, asserts new delay > old and queue size still exactly 3.
- Date format helper extracted to `services/format-datetime.ts` and reused by booking-confirmation SMS (chunk 12 + 14 path) and the 48h reminder template. Single source.
- `apps/api/scripts/fire-reminder.ts` + `pnpm dev:fire-reminder` for promoting a delayed job in local dev. Operator-facing version lands in chunk 22.
- 36 → (api) test files, 195 tests pass. Web suite at 40 tests, all green.

### Chunk 14 — Twilio twin + adapter + booking confirmation SMS
- New `twins/twilio` package mirrors `twins/stripe` shape. `POST /2010-04-01/Accounts/:sid/Messages.json` for outbound + `POST /__twin_inbound` test helper that fires properly-signed POSTs to the api's inbound webhook (lets tests simulate "customer texted STOP" without spinning up real Twilio).
- Adapter: `apps/api/src/adapters/twilio/{live,twin}.ts` + shared `compose.ts` for the pre-flight (tier gate / opt-out / idempotency / STOP suffix / 160-char truncation). Both implementations are thin wrappers over `compose.preflightSend` → actual send.
- Schema: `20260520000000_sms_opt_out_and_messages` adds `Client.smsOptOutAt`, renames `toPhone/fromPhone → toE164/fromE164`, adds outbound `idempotencyKey` (partial unique index), `sentAt`, tightens `clientId` FK to cascade. `SmsStatus` enum: `pending | sent | error | skipped_tier | skipped_opt_out`.
- Inbound `/webhooks/twilio` verifies `X-Twilio-Signature` first (HMAC-SHA1 of URL + alpha-sorted form-param `${key}${value}` concat, base64). Dedupes by MessageSid via chunk-10 WebhookEvent. STOP/START canonical sets; case-insensitive trimmed body match. Matches Client by 10-digit phone suffix.
- Booking confirmation wired in `payment-intent-succeeded.ts:203`. Idempotency key `booking-confirmation:${appointmentId}`. The chunk-12 TODO marker is gone.
- Phone helper extracted from chunk 12 into `apps/api/src/services/phone.ts` (`normalizePhone`, `tenDigitSuffix`, `suffixesMatch`, `toDialFormat`). chunk-12's inline copy is removed.
- PII redact list extended for `toE164`, `fromE164`, SMS `body`. Phone numbers still allowed in customer-display rendering paths (UI), never in logs.
- Web: opt-out badge on `clients/detail.tsx`; opt-out banner on `calendar/new-appointment-sheet.tsx` (doesn't block submit, just informs).
- Signature gotcha worth knowing for chunk 22 / future twin work: base64 padding bytes after the `=` decode to nothing — a test that tampers the trailing characters can still "verify." The fix is to flip a leading char in tamper tests. Documented in `twins/twilio/src/sign.test.ts`.
- 32 → (api) test files, 172 tests pass. New `twins/twilio` suite + integration tests.

### Chunk 13 — Tier upgrade/downgrade + Customer Portal
- Twin: `POST /v1/billing_portal/sessions`, `POST /v1/invoices/upcoming` (simple linear-proration computation: `credit = currentPrice * (timeRemaining/period); charge = newPrice * (timeRemaining/period); amount_due = max(0, charge - credit)`), idempotency wired into `POST /v1/subscriptions/:id` so retried updates produce one effect.
- Adapter: `previewPlanChange`, `changePlan`, `createPortalSession` in both live + twin. Idempotency key for change-plan is `tenantId:${ts-bucketed-to-5min}` — accidental double-clicks within 5min are one call; after the bucket rolls, retries get a fresh key because proration math will have shifted.
- Schema: `Tenant.stripeSubscriptionItemId`, `Tenant.lastPlanChangeAt`, new `TenantPlanChange` table (id, tenantId, fromPlan, toPlan, prorationAmountCents, createdAt). Migration: `20260518000000_tenant_subscription_item_and_plan_history`. Backfill at signup is automatic from chunk-10 wiring; the migration's one-time backfill handles existing rows.
- API: `apps/api/src/routes/settings/billing.ts` (GET billing summary + preview + change-plan + portal-session). Idempotency key per change-plan call. Returns 202; webhook does the canonical flip.
- Webhook: `subscription-updated.ts` extended with `priceIdToPlan` mapping from env price IDs → PlanTier. Records a TenantPlanChange row + updates `Tenant.plan` + `lastPlanChangeAt`. Idempotent via chunk-10 `UNIQUE(source, eventId)`.
- Web: `/settings/billing` page — current-plan card + 3-tier matrix + two-step preview/confirm modal. After confirm, polls GET /settings/billing every 2s for up to 30s to reflect the tier flip. Customer Portal button → window.location.href to Stripe-hosted portal URL.
- Pre-existing `conflict.test.ts` flake: `plus()` was now-relative; offsets > a few hours could cross midnight, and `canPlaceAppointment` only buffers same-day neighbors → spurious pass. Pre-flight cleanup (chunk 13 → 14): anchor `plus()` to next-non-Sunday 10am; the "past" test uses a literal `Date.now() - 60min`.

### Chunk 12 — Connect onboarding + public booking submit
- Stripe Connect onboarding is **lazy**: connected account created on first visit to `/settings/payments`. Onboarding URL redirects to Stripe (twin auto-completes in dev), returns to the same page. `account.updated` webhook syncs `Tenant.stripeConnectChargesEnabled`/`payoutsEnabled`. The GET endpoint refetches `getConnectAccount` on every load so post-redirect state feels instant even if the webhook hasn't arrived.
- Submit flow: form → geocode customer address inline → re-validate slot with **real customer coords** via `canPlaceAppointment` → create `BookingPageRequest pending_payment` → create payment intent on the connected account → return `{ bookingRequestId, clientSecret }` to the Payment Element. The chunk-11 depot-coord stand-in is no longer load-bearing for submit — every booking re-checks with real coords.
- `BookingPageRequest` is the staging row; **the webhook handler promotes it to `Appointment`** on `payment_intent.succeeded`. Snapshot fields populated from the service at promote time. `match-or-create Client by phone` (10-digit suffix comparison, no E.164 normalization v1) + match-or-create Pet by name+breed. Phone-normalization function in `payment-intent-succeeded.ts`; flagged for libphonenumber upgrade in v2 with international rollout.
- **Idempotency, two layers:** (1) duplicate submits with same `{serviceId, requestedStart, ownerPhone}` reuse the existing pending row instead of creating a new `BookingPageRequest`; (2) the bookingRequestId is passed as Stripe idempotency-key on payment-intent creation. Webhook replay handled by chunk-10 `UNIQUE(source,eventId)` pattern.
- **Expiry is lazy in two places** — `availability.ts` flips past-TTL `pending_payment` rows to `expired` via `updateMany` before computing candidates; `booking-status.ts` flips per-row on poll. No BullMQ until chunk 17+ adds enough scheduled work to justify it. TTL: 30 min.
- Schema additions in `20260517120000_connect_and_booking_requests`: Tenant gets `stripeConnectAccountId/chargesEnabled/payoutsEnabled/statusUpdatedAt`. BookingPageRequest gains `addressState/Lat/Lng`, `durationMin`, `depositCents`, `expiresAt`, `petTemperamentNotes`, `petVaccinationExpiry`, new status enum (`pending_payment|succeeded|failed|expired|promoted`). Chunk 2 had gaps in BookingPageRequest — filled here.
- **Twin/live divergence the recap missed:** real Stripe.js (`loadStripe`) refuses to talk to the twin (hardcoded to js.stripe.com). The web detects `STRIPE_PUBLISHABLE_KEY` prefix `pk_twin_` and renders a stub Payment Element that POSTs to `/public/:slug/bookings/:id/twin-confirm` instead. Live keys exercise the real Payment Element. README "Public booking flow" explains.
- Application fee `0` on the platform v1 — `application_fee_amount: 0` with `// TODO v2: monetize Connect` marker. Direct charge on connected account via `transfer_data[destination]` + `on_behalf_of`.
- Email confirmation via existing stdout email adapter; SMS confirmation deferred (chunk 14) with explicit `// chunk 14: enqueue SMS confirmation` marker in the webhook promote handler.
- **PII redact list extended** for the booking submit path (customer name/phone/email/full address). New pino redact paths in `app.ts`.
- Tests: split `submit.test.ts` (was 543 LOC, violated 400-LOC rule) into `submit.test.ts` + `submit.test-utils.ts` + `payment-intent-succeeded.test.ts` (co-located with handler). Added `fileParallelism: false` to `apps/api/vitest.config.ts` — the split exposed a race between the two files concurrently signing up tenants. Suite went 17s → 35s. Acceptable.
- 27 → 28 API test files, 117 → 136 tests. New stripe-adapter integration tests cover Connect onboarding, PI idempotency, twin confirm with metadata round-trip, and refund.
- Pre-existing chunk-10 guard test in `stripe.test.ts` asserted live Connect methods still throw `"not implemented"` — removed during chunk-12 follow-up. The original chunk 12 agent missed deleting it.
- Pre-existing `apps/web/src/routes/calendar/calendar.test.tsx` is 405 LOC, 5 over the constitution. Pre-dates chunk 12; left for a future cleanup chunk.

---

## Open caveats / known minor issues

- **Drag snap stutter** (chunk 9): defer until real-phone user complaints. Fix path: render unsnapped ghost separately from the snapped commit position.
- **Confirmation SMS** doesn't fire yet (twilio twin+adapter come in chunk 14). Chunk 12 left a `// chunk 14: enqueue SMS confirmation` marker in `payment-intent-succeeded.ts`.
- **Twin Stripe.js stub** (chunk 12): real `loadStripe()` is hardcoded to js.stripe.com and can't reach the local twin. The web detects `pk_twin_` keys and renders a stub Payment Element that hits `/public/:slug/bookings/:id/twin-confirm`. The route 404s in live mode. Not a problem for the chunk-12 dev loop but worth knowing if someone wires Apple Pay / Google Pay buttons (chunk 12 OOS) and expects them to work against the twin.
- **`confirmTwinPaymentIntent` on the adapter interface** (chunk 12): live mode throws on call. Kept on the interface for type unity. Only used by the twin-confirm route.
- **Manage-booking UI for customers** (chunk 12): `/public/booked/:requestId` links to `/public/manage/...` which renders a "coming soon" page. Chunk 17 (recurring + reschedule) implements the real signed-token UI.
- **API tests require Docker** for Postgres on port 5433. `pnpm db:migrate` won't run without it. WSL2 + Docker Desktop on Windows; native Docker elsewhere. Web + twin tests are DB-free and run regardless.
- **`apps/web/src/routes/calendar/calendar.test.tsx`** is 405 LOC, 5 over the constitution's 400-LOC rule. Pre-dates chunk 12; landed in chunk 9. Defer to a discrete cleanup chunk when other 400-LOC creep accumulates.
- **`vitest fileParallelism: false`** for `apps/api` (chunk 12): API tests share a Postgres + signup-by-timestamp pattern. The chunk-12 test split exposed the race. Suite is 35s serial; if it grows past ~90s, fix the shared-state pattern (per-test schema or tenant-namespaced webhook prefixes) and re-enable parallelism.
- **Tenant business hours hardcoded** Mon-Sat 8am-5pm in availability service. Tenant-configurable hours land in chunk 22.
- **Geocode twin coverage**: Plano/McKinney/Frisco only. Extend the zip-centroid table as scenarios demand.
- **Orphan-tenant sweep** (unpaid Tenants from abandoned signup) defers to chunk 22.
- **Operator log UI** for failed jobs / dead-lettered webhooks defers to chunk 22.

---

## Pre-flight cleanups history

These landed as discrete edits between chunks. Listed so future debugging doesn't trace back to a chunk that didn't introduce them.

| When | What |
|------|------|
| chunk 1 → 2 | Throwaway Prisma `Health` model added (so `prisma generate` works pre-real-schema); removed in chunk 2 |
| chunk 1 → 2 | `pnpm preflight` script wraps `pnpm dev` (docker daemon check) |
| chunk 1 → 2 | Vitest wired root + workspaces, smoke test in `apps/api` |
| chunk 2 → 3 | `User.email` switched from `@@unique([tenantId, email])` to global `@unique` |
| chunk 4 → 5 | `app.sessionStore` and `app.emailAdapter` decorators consolidated into `app.adapters` bag |
| chunk 6 → 7 | `photoUrl` input removed from pet form (upload pipeline deferred — photo upload may land as sub-chunk between 8 and 9 if scenarios demand) |
| chunk 8 → 9 | `Tenant.defaultBufferMinutes Int @default(15)` migration (actually landed inside chunk 9, not as separate pre-flight) |
| chunk 10 → 11 | 3 lint errors in chunk 10 files fixed post-recap (`app.ts` import type, `form-body.ts` unused var, `app.test.ts` any-typing) |
| chunk 12 → 13 | Stale chunk-10 guard test removed (`stripe.test.ts` asserting live Connect throws "not implemented"); `submit.test.ts` palette-color fix (`#000000` → `#6b7280`); `submit.test.ts` split into 3 files for 400-LOC; `apps/api/vitest.config.ts` `fileParallelism: false` after the split |
| chunk 13 → 14 | `conflict.test.ts` time-of-day flake fixed: `plus()` anchored to next-non-Sunday 10am so future-time offsets don't cross midnight (was failing in evenings); "past" test switched to a literal `Date.now() - 60min` |

---

## What to do when you arrive on a new machine

```bash
# 1. Clone
git clone https://github.com/petermanrique101-sys/mygroomtime.git
cd mygroomtime

# 2. Install
pnpm i

# 3. Set up env (copy template, fill in any real keys you have)
cp .env.example .env

# 4. Start infra
pnpm preflight
docker compose up -d
pnpm db:migrate
pnpm db:seed

# 5. Run app
pnpm dev

# 6. Read this file + spec/plan.md + NEXT_CHUNK.md
# 7. Paste NEXT_CHUNK.md into a fresh /senior-engineer or /vibe-code session
```

You'll be ready in under 10 minutes.
