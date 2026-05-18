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
| 16 | Route optimization + day route view | ✅ done, committed |
| 16.5 | Appointment lifecycle + complete + rebook | ✅ done, committed |
| 17 | Recurring materialization + reschedule | ✅ done, committed |
| 18 | Offline support (PWA, mutation queue, MutationLog) | ✅ done, committed |
| 19 | Owner dashboard | ✅ done, committed |
| 20 | Twin: Google Calendar + two-way sync (Pro+) | ✅ done, committed |
| 21 | Business tier: multi-vehicle dispatch + payroll splits | ✅ done, committed |
| **22** | **Operator log + admin polish + production readiness** | **← next (final v1 chunk), prompt in NEXT_CHUNK.md** |

After chunk 22: human evaluator runs the 8 scenarios in `scenarios/` per `SCENARIO_RUBRIC.md`. All must score 8+ to declare v1 done.

---

## Cross-chunk policy decisions (not all in spec yet)

These were locked in via chunk prompts. Honor them in future chunks.

### Business tier dispatch + payroll + ops calendar (chunk 21)
- **Multi-vehicle is Business-only.** Pro/Starter keep the single-vehicle day view. New `requireBusinessTier` middleware on vehicles CRUD, payroll routes, ops-calendar setup. 403 with `reason: 'business_tier_required'`.
- **Vehicle owns its default driver.** `Vehicle.assignedGroomerId` (nullable). Appointments inherit `groomerId` from vehicle on create unless owner explicitly pins.
- **Cross-vehicle drag = reschedule + reassignment.** Owner pin detected by PATCH-body presence: if `groomerId` is in the payload (even `null`), it's an explicit pin and we don't override. If absent AND vehicleId changed, we inherit the destination vehicle's `assignedGroomerId`. Both vehicles' routes recompute; reminders remove+add via the chunk-15 path; per-user gcal pushes fire for both old and new groomers.
- **Phone UX: bottom sheet, not physical drag.** Dispatch view is horizontally-scrollable columns on phone; "Move to vehicle" bottom sheet picker replaces cross-column drag below ~768px. Within-column drag still works via chunk-9 mechanics. The hard 409 conflict path unchanged regardless of input affordance.
- **Vehicle delete is service-layer blocked** (not DB-constraint): 409 `future_appointments` if any scheduled/on_the_way/started appts assigned; 409 `last_active_vehicle` if would leave 0 active. Same checks on PATCH active=false.
- **Payroll period config**: `Tenant.payrollPeriodKind: weekly | biweekly` (default biweekly) + `payrollPeriodAnchorDate` for biweekly cycle math. Server TZ for v1 (chunk 22 adds tenant TZ).
- **Payroll splits = sum(finalAmountCents) where status=completed AND completedAt in period AND groomerId=X.** Tips broken out separately via `tipCents`. Refunds NOT subtracted in v1 — `// TODO chunk 22: subtract refunds`.
- **CSV export columns** (BOM-prefixed for Excel): `period_start, period_end, groomer_email, groomer_name, appointments_completed, revenue_cents, tips_cents, total_cents`. Customer PII never in the CSV — only groomer fields. Filename: `payroll-{tenant_slug}-{period_start}.csv`.
- **Operations calendar (Business-only, optional).** `GoogleCalendarLink.linkKind` enum extends to `user | tenant_operations`. Dropped old `(userId) UNIQUE`, replaced with `(userId, linkKind)` unique. Partial unique on `(tenantId) WHERE linkKind='tenant_operations'` enforces one ops link per tenant. `userId` is nullable for tenant_operations rows.
- **Ops calendar is write-only.** Push events for every appointment in the tenant, on top of the per-user push (dual push). No pull-side sync (keeps surface small). Disconnect removes the ops link only; per-user links unaffected.
- **Dual-push idempotency keys differ by linkKind**: `gcal-push.{kind}.{linkKind}.{appointmentId}`. User and ops pushes never collide. BullMQ `.` separator (chunk-15 lesson). `Appointment.opsGoogleEventId` added alongside `googleEventId` so the two events can be tracked independently.

### Google Calendar two-way sync (chunk 20)
- **Per-user GoogleCalendarLink** (chunk 21 extends with `linkKind`). Each groomer connects their own Google account; appointments push to the assigned groomer's calendar via `Appointment.groomerId`. Unassigned appointments don't push.
- **Pull-side sync is TIGHTENED**: only ingest changes to events we created (matched by `extendedProperties.private.mgtAppointmentId`). External brand-new events without our tag are IGNORED — protects against the groomer's dentist appointments becoming Appointments.
- **Field mapping**: `summary = "{serviceNameSnapshot} — {petName}"`; `start/end.dateTime` from `scheduledStart` + `durationMin`; `description = notes + address (override or client)`; `extendedProperties.private` carries `mgtAppointmentId` + `mgtTenantId`. Status changes don't sync to Google (no equivalent); canceled = Google event deletion.
- **Conflict resolution**: rank by `(externalUpdated, ourUpdated)` lexicographic, our-wins on tie. Always preserve from our row regardless of who wins on time/title: `depositChargeId`, `balanceChargeId`, `recurringSeriesId`, `mutationUuid`, all snapshot columns, `addressOverride*`. Google doesn't know these exist.
- **`no_change` short-circuit** in conflict service: when Google "wins" by timestamp but start/duration/notes haven't actually drifted (irrelevant Google-side edit bumped `updated`), return `no_change` instead of an empty patch. Saves a DB write and a reminder reschedule.
- **OAuth scope**: only `https://www.googleapis.com/auth/calendar.events` (event-level, not full calendar list / ACL). Token storage: refresh token encrypted at rest with AES-256-GCM, ciphertext prefixed `v1:` for forward-compatible rotation. Access tokens cached in Redis under `gcal-token:{userId}` with TTL `expires_in - 60s`.
- **Token refresh race**: `SET NX PX=5000` lock at `gcal-token-lock:{userId}`; losers poll the cache key for up to 5s and pick up the winner's refreshed value. Lock holder crash falls through to a fresh refresh after the TTL. No thundering herd.
- **Watch channel renewal**: daily cron `0 3 * * *` refreshes any link with `watchExpirationAt < now+48h`. After 3 consecutive renew failures, set `needsReauth=true`; user sees "Reconnect" CTA. Channel-token (`X-Goog-Channel-Token`) is the per-link secret used at webhook verify time.
- **Tier gate**: Pro+ only. Backend returns 403 with `reason: 'tier_gated'` for Starter/unpaid/past_due/canceled.
- **Encryption key**: `GCAL_TOKEN_ENCRYPTION_KEY` (32-byte base64). Dev fallback is a deterministic 32-byte string so `pnpm dev` works; production MUST set the env var — no fallback there.
- **Soft-deleting a client doesn't fire any gcal-push.** Soft-delete is just a flag on the client; the underlying appointments are still scheduled in our DB and in Google. If the appointment is later canceled or deleted, the existing push path tears the Google event down. Consistent with chunk 6 policy.

### Owner dashboard (chunk 19)
- **All metrics server-side over server-side timestamps.** `completedAt`, `startedAt`, `finalAmountCents`, `tipCents`. Never trust client clocks.
- **Duration metric** = `completedAt - startedAt` (actual service time). Documented offline-replay skew (chunk 18 surfaces this — the server-side `completedAt` is set when the replay lands, not when the user tapped Complete). Acceptable for v1.
- **Tenant timezone = server UTC for v1**, TODO marker for chunk 22 to add per-tenant TZ. Affects revenue-by-day boundaries.
- **Revenue widget = sum(finalAmountCents) where status='completed' in window.** Tips already included. Refunds NOT subtracted in v1 — `// TODO chunk 22: subtract refunds`. Chunk 22 surfaces gross + net.
- **No-show rate (last 30d)** = `count(no_show) / count(completed + no_show)` over completedAt OR noShowAt in window. Incomplete statuses (scheduled, started, etc.) excluded.
- **Top clients (last 90d)** = sum(finalAmountCents) per clientId, desc, limit 5. Soft-deleted clients tagged "(removed)" but still appear (they had real revenue).
- **Gaps to fill (next 7d)** = active `RecurringSeries` where last completed parent is overdue by >1 week past `intervalWeeks`. Surfaces "{petName} ({clientName}) — last groomed N days ago, normally every X weeks." Series with no completed parent yet are skipped.
- **Single API call, parallel fan-out, per-widget error containment.** `GET /dashboard` runs all 5 services in `Promise.all`; one widget failing returns `{ ...metric, error: 'unavailable' }` so the dashboard never black-screens.
- **Drill-down endpoints separate**: `/dashboard/revenue`, `/no-shows`, `/top-clients`, `/gaps-to-fill` — each paginated. Each widget tappable → drill-down route.
- **All paid plans get dashboard.** Starter's gaps-to-fill widget returns `{ items: [], gated: true, reason: 'recurring_requires_pro' }` (200, not 403) so the widget renders the upgrade copy in-place.
- **Hand-rolled SVG line chart** for revenue drill-down. No new chart-lib dep. Chunk 22 may extend with refund deltas.

### Offline support + MutationLog (chunk 18)
- **Generic `MutationLog` table is the dedup truth** for owner-side writes. Header `X-Mutation-Id` (client-generated UUIDv7) is required on every owner mutation route. Lookup-by-id short-circuits with the captured `resultPayloadJson` if processed before. The chunk-2 `Appointment.mutationUuid @unique` stays as a layered fallback (defends against the race between handler success and the `onResponse` MutationLog persist hook).
- **Public/jti-protected endpoints DON'T use MutationLog.** Public reschedule commit (jti single-use), public booking submit (Stripe idempotency-key + BookingPageRequest unique), webhook handlers (WebhookEvent unique) all already have their own idempotency. Don't double-layer.
- **Replay order = client-creation order**, NOT server-receive order. UUIDv7 is sortable. Replay is serialized per (tenantId, resourceId) so cause-and-effect is preserved across concurrent reconnects.
- **Stripe idempotency key under replay** = `mut-{mutationUuid}` when MutationLog is in play, else falls back to the resource-specific key (`complete-{appointmentId}` etc). Helper: `stripe-idempotency.ts`. Complete-flow under offline replay: exactly one PI per Complete, never double-charges across the offline boundary.
- **Conflict resolution policy = server wins, surface the diff.** Failed replays land in a "needs attention" panel with captured intent + current server state. V1 ships discard-only; retry-with-edit is v2.
- **Cached read surface (PWA cache)** = today's appointments + today's buffers + Pets/Clients referenced + Service catalog + Tenant profile. NOT the whole month — day view is the offline target. Other views show offline empty-state. Stale time 5 min while online, forced refresh on reconnect.
- **Background Sync API where available** (Chrome/Edge); silent `try/catch` fallback to `window.online` event handler everywhere else (Safari iOS, Firefox).
- **Offline banner** = top, neutral color, "Offline — N changes queued" / "Syncing — N left" / "All caught up" (fades). No red, no alarms.
- **Retry policy**: exponential backoff up to 5 attempts on 5xx/network. 4xx → straight to conflict panel (no retry).
- **MutationLog 90-day retention** documented; sweep job deferred to chunk 22.

### Recurring materialization + customer reschedule (chunk 17)
- **Materialization horizon = 14 days.** Nightly BullMQ repeat (`recurring-materialize` queue, cron `0 2 * * *`) walks `RecurringSeries` where `active AND nextDueDate <= now+14d AND (nextMaterializationAttemptAt IS NULL OR <= now)`. The walker (`materializeAllDueSeries`) iterates and calls `materializeOneSeries({seriesId,tenantId})` per row. Per-series throws are caught so a single bad row never aborts the walk.
- **Auto-pause cases.** `pauseReason='source_deleted'` if `client.deletedAt` or `pet.deletedAt` is non-null at materialization time. `pauseReason='no_available_slot'` after `MAX_CONSECUTIVE_FAILED_MATERIALIZATIONS=7` consecutive `canPlaceAppointment` rejections; counter resets to 0 on a successful materialization or on owner resume. Owner pause is `pauseReason='owner_paused'` (chunk-17 detail-drawer button).
- **Idempotency** is `(seriesId, nextDueDate)`. If an appointment exists with that exact `(recurringSeriesId, scheduledStart)`, the walker returns `skipped_already_materialized` and does NOT advance `nextDueDate` — that's owned by the next successful materialization.
- **Snapshot source.** Latest completed appointment in the series → its snapshot. None yet → live `Service`. Locks future-instance pricing to the chain's first completed parent so service re-pricing doesn't drift downstream.
- **7-day reminder is a new kind in the chunk-15 queue.** Same `REMINDER_QUEUE`, name `reminder-7d`, job id `reminder-7d.<appointmentId>`. Skipped at enqueue if the appointment is ≤7d away. Body: `Reminder from {tenant}: {pet}'s {service} is coming up on {dateTime}. Reply C to confirm, R to reschedule.` Long tenant/service names get the adapter's `…` truncation before the STOP suffix — the dispatcher matches `C`/`R` as exact-trimmed body, so a truncated footer doesn't break confirmations.
- **Inbound dispatcher (`apps/api/src/services/inbound-sms-dispatch.ts`)** routes the inbound webhook with strict priority: STOP-set → RESCHEDULE (exact `R`/`r` OR substring `RESCHEDULE`) → confirm (`C`/`Y`/`YES` exact) → START/UNSTOP → fallback. The "recent appointment" lookup excludes `reminder-post:*` SmsMessage rows (post-appointment reviews shouldn't trigger reschedule links).
- **Reschedule token** = jose JWT (`HS256`, `RESCHEDULE_TOKEN_SECRET`). Payload: `{ type: 'reschedule', appointmentId, tenantId }` + `jti`. Expires at `appointment.scheduledStart + 6h` grace. Single-use enforced via Redis-backed jti consume (new `SessionStore.recordRescheduleJti` / `consumeRescheduleJti` on both memory + redis stores).
- **Reschedule commit order: signature → load → slot-check → consume-jti → swap.** A slot conflict at commit time returns 409 `slot_unavailable` and does NOT consume the jti (customer retries with a different slot). An already-used token returns 409 `already_used` with `linkedAppointmentId` so the page can render "your appointment is on {date}".
- **Reschedule preserves `depositChargeId`.** The new appointment inherits it byte-for-byte; no new Stripe call is made. `Appointment.rescheduledFromAppointmentId` (new column) records the source for the already-used lookup path.
- **Materialized appointments don't carry a deposit.** A series-materialized appointment is a fresh instance; the chunk-12 `depositChargeId` only exists when the public booking flow charged a deposit. Reschedule preserves whatever was there (commonly nothing).
- **Cross-tenant access for the walk.** `db.global.recurringSeries` was added — explicitly documented as walker-only. Application code MUST go through `db.forTenant(tenantId).recurringSeries` for tenant-scoped reads.
- **Owner pause is one button on the detail drawer.** `AppointmentOutput.recurringSeriesId` + `.recurringSeriesActive` (new fields) drive the badge. `POST /recurring-series/:id/pause` and `/resume` are owner-authed + `requirePaidPlan`-gated. Pause does NOT cancel already-materialized future instances — owner cancels those individually.

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

### Chunk 21 — Business tier dispatch + payroll + ops calendar
- Shipped as ONE chunk. Schema delta was small (3 enums/columns) and the ops calendar plugged cleanly into the chunk-20 linkKind discriminator pattern.
- Schema: `Vehicle.assignedGroomerId/active/deletedAt`, `Tenant.payrollPeriodKind/Anchor`, `GoogleCalendarLink.linkKind` enum + composite `(userId, linkKind)` unique + partial unique on `tenantId WHERE linkKind='tenant_operations'`, `Appointment.opsGoogleEventId`, two new enums, dispatch + payroll indexes. Migration `20260529000000_business_tier_dispatch_and_payroll`.
- API: `middleware/require-business-tier.ts`; `routes/vehicles/` (CRUD); `routes/payroll/` (periods + splits + CSV); `routes/settings/integrations/google-calendar-operations/` (status + connect + disconnect); cross-vehicle drag test `appointments-dispatch.test.ts`.
- Services: `payroll-periods.ts`, `payroll-splits.ts`, `payroll-csv.ts` (+ tests).
- Web: `routes/settings/vehicles.tsx`, `routes/payroll/`, `routes/calendar/dispatch-view.tsx` + `mode-toggle.tsx`, `routes/settings/integrations/google-calendar-operations.tsx`. API clients: `vehicles-api.ts`, `payroll-api.ts`.
- Push worker dispatch by linkKind (existing chunk-20 worker, default `'user'` for back-compat). `gcal-enqueue` fans out to both user + ops links. JobIds: `gcal-push.{kind}.{linkKind}.{appointmentId}`.
- Vehicle delete-blocking is service-layer (not DB constraint): `future_appointments` and `last_active_vehicle` checks live in `delete.ts` and the PATCH active=false handler.
- Payroll CSV: BOM-prefixed, tested for groomer-name commas, doubled inner quotes, newlines. Byte-for-byte assertion.
- Phone UX call: bottom sheet "Move to vehicle" instead of physical cross-column drag. 220px min-width columns with `snap-x snap-mandatory` horizontal scroll. Within-column drag preserved via chunk-9 DayGrid.
- Tests: 377 api / 103 web. `calendar/index.tsx` was 434 LOC, split into `mode-toggle.tsx` to fit ≤400.

### Chunk 20 — Google Calendar twin + adapter + two-way sync (Pro+)
- Shipped as ONE chunk.
- Twin (`twins/google-calendar/`): `app.ts`, `state.ts`, `auth.ts`, `events.ts`, `server.ts`, plus `routes/{oauth, calendar-list, events, watch, admin}.ts`. 10/10 tests green.
- Adapter (`apps/api/src/adapters/gcal/`): types (extended), `parse.ts`, `http.ts`, `impl.ts` (shared logic), `live.ts` (real Google URLs + `buildLiveAuthorizeUrl`), `twin.ts` (twin URLs + `buildTwinAuthorizeUrl`). Tests: rewritten `gcal.test.ts`, `gcal.integration.test.ts`, `gcal-e2e.integration.test.ts`.
- Schema migrations: `20260528000000_google_calendar_link` (table + ALTER TYPE WebhookSource ADD VALUE 'google_calendar') and `20260528010000_appointment_google_event_id`.
- Queues: `gcal-connection.ts` (3 queues — push, pull, renew), `gcal-push-worker.ts`, `gcal-pull-worker.ts`, `gcal-renew-worker.ts`, `gcal-infra.ts` (factory split out of `app.ts` to keep it under 400 LOC).
- Services: `token-encrypt.ts` (AES-256-GCM, `v1:` prefix), `gcal-conflict.ts` (9-case test), `gcal-payload.ts`, `gcal-enqueue.ts`, `gcal-token-cache.ts` (Redis lock + poll-the-cache), `gcal-oauth-state.ts`.
- Routes: `routes/settings/integrations/google-calendar/{status, connect, callback, disconnect, index}.ts`, `routes/webhooks/google-calendar.ts`, `middleware/require-pro-tier.ts`. Push enqueue wired into every appointment-mutating route.
- Web: `lib/gcal-api.ts`, `routes/settings/integrations/google-calendar.tsx`.
- Encryption fallback in dev (deterministic 32-byte key); hard fail in prod when env unset.
- 357 api / 98 web / 10 gcal-twin tests. 0 unannotated skips. Reminder tests stable.

### Chunk 19 — Owner dashboard
- Services (`apps/api/src/services/dashboard/`): `revenue.ts`, `no-show-rate.ts`, `top-clients.ts`, `gaps-to-fill.ts`, `duration.ts`, `windows.ts`, `index.ts` (parallel fan-out + per-widget error containment).
- Routes (`apps/api/src/routes/dashboard/`): `summary.ts` (Cache-Control private max-age=30), `revenue.ts`, `no-shows.ts`, `top-clients.ts`, `gaps-to-fill.ts`, `index.ts`. All requireAuth + requirePaidPlan. Starter's gaps-to-fill returns gated payload (200), not 403.
- Shared: `packages/shared/src/dashboard.ts` (Zod schemas + types per payload).
- Web: 6 widgets (revenue, no-show, duration, top-clients, gaps, today-route) + 4 drill-downs. Hand-rolled SVG line chart for revenue (no new deps). Per-widget AND whole-page empty-state strategy.
- Indexes: none added — `Appointment(tenantId, completedAt)` + `RecurringSeries(tenantId, active, nextDueDate)` already covered.
- Default landing route: kept `/` → `/calendar` (spec flow 3 — day-of working tool). Dashboard one tap from calendar header.
- Performance: getDashboardSummary measured <200ms with 1000 completed appointments (target was <500ms p95).
- Tests: +16 service, +9 route, +14 web. 319/319 api at recap time.

### Chunk 18 — Offline support (PWA, mutation queue, MutationLog)
- Schema: `MutationLog` table (id PK = client UUIDv7, tenantId, userId, endpoint, resourceType, resourceId, status enum, failureReason, resultPayloadJson JSONB, createdAt). Migration `20260527000000_mutation_log`.
- API middleware: `mutation-dedupe.ts` (header read, lookup + short-circuit on processed, capture + persist hooks via `onSend` + `onResponse`).
- Service: `stripe-idempotency.ts` (mut-{uuid} ⇆ resource-key fallback). `complete-appointment.ts` takes mutation context and routes the idempotency key through the helper.
- Applied to every owner-side write: appointments {create, update, delete, status, complete, rebook, route-apply}, recurring-series {pause, resume}, clients/services CRUD. NOT applied to /me, /auth/*, /billing*, /webhooks/*, public/* (those have their own idempotency).
- Web: `uuid-v7.ts`, `offline-queue.ts` (idb, v1 schema), `offline-bus.ts`, `offline-api.ts`, `offline-replay.ts`, `sw-bridge.ts`, `use-offline-queue.ts`, `use-last-synced.ts`. Components: `offline-banner.tsx`, `queued-mutations-modal.tsx`.
- PWA: `vite-plugin-pwa` injectManifest. Custom service worker at `src/sw.ts` with NetworkFirst runtime cache for today's read surface + Background Sync registration.
- Background Sync: Chrome/Edge get the API; Safari iOS + Firefox fall back to `window.online` via silent try/catch.
- Tests: `offline-queue.test.ts` (7), `offline-api.test.ts` (4), `offline-replay.test.ts` (4), `offline-banner.test.tsx` (4), `offline-integration.test.ts` (2 — lifecycle replay + 4xx conflict). `mutation-dedupe.test.ts` (6).
- Verified: replay returns original payload; failed-replay returns original 4xx; missing header on write → 400; GET not enforced; Complete under replay → exactly one Stripe PI; cross-tenant rejected.

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

### Chunk 17 — Recurring materialization + customer reschedule
- Schema: `20260526000000_recurring_series_pause_and_appointment_reschedule_link` adds `RecurringSeries.{pausedAt, pauseReason, nextMaterializationAttemptAt, consecutiveFailedMaterializations}` + `Appointment.rescheduledFromAppointmentId` + the cross-tenant `(active, nextDueDate)` index for the nightly walk.
- Materialize service: `apps/api/src/services/materialize-series.ts` (`materializeOneSeries` — one row, full lifecycle) + `materialize-series-walk.ts` (`findDueSeries` + `materializeAllDueSeries` — the cross-tenant scan). Split because the combined file exceeded 400 LOC. The walker swallows per-row throws so a single bad series never aborts the night.
- Queue: `apps/api/src/queue/{materialize-connection.ts, materialize-worker.ts}` with `MATERIALIZE_QUEUE='recurring-materialize'`. `createApp` registers a BullMQ repeat (`pattern: '0 2 * * *'`) so app boot is the only place the schedule is declared. Both reminder + materialize infra are skipped in test mode unless explicitly injected — same pattern as chunk 15.
- 7-day reminder: `reminder-7d` added to `REMINDER_JOB_NAMES` + the worker dispatch + a body template. `computeReminderTimestamps` returns `sevenD: Date | null`. `enqueueAppointmentReminders` skips the 7d job when start - now ≤ 7d. Materialization explicitly re-enqueues via the same helper so far-future series instances get all four kinds.
- Reschedule tokens: `apps/api/src/services/reschedule-tokens.ts` issues HS256 JWTs over `{appointmentId, tenantId, jti}`; jti recorded via the new `SessionStore.recordRescheduleJti` (memory + redis). The URL is built as `${scheme}://${tenantSlug}.${host}/public/reschedule/${token}` from `WEB_ORIGIN`.
- Inbound dispatcher: `apps/api/src/services/inbound-sms-dispatch.ts` is the new hub. `routes/webhooks/twilio/index.ts` lost its inline STOP-only branching and now delegates everything to `dispatchInbound`. STOP behavior is unchanged (priority 1). The dispatcher hits all matching tenants when one phone is on multiple groomer rosters.
- Public reschedule routes: `apps/api/src/routes/public/{reschedule-verify.ts, reschedule-commit.ts, reschedule-load.ts}` — the commit path runs `canPlaceAppointment` BEFORE consuming the jti so a conflict at commit-time leaves the token live. Already-used returns 409 with `linkedAppointmentId` (looked up via the new `rescheduledFromAppointmentId`). Inside the swap transaction: cancel old (status=canceled, canceledAt=now) + create new with the same `depositChargeId`, `recurringSeriesId`, snapshot fields, and `rescheduledFromAppointmentId=source.id`. Chunk-15 reminder remove + enqueue runs after the transaction commits.
- Owner pause/resume: `apps/api/src/routes/recurring-series/index.ts` exposes `POST /recurring-series/:id/{pause,resume}`. `AppointmentOutput` now carries `recurringSeriesId` + `recurringSeriesActive` so the calendar detail drawer can render the "Recurring" badge + pause button without a separate fetch. `findActiveAppointment` includes the `recurringSeries` relation; `serializeAppointment` reads it via an optional `?? null` so call sites that don't load it (rebook short-path) still compile.
- Web: `apps/web/src/routes/public/reschedule.tsx` is the customer-facing page (mobile-first, light mode, ≥44px tap targets) — verifies the token, reuses the chunk-11 `DatePicker` + a slot grid from chunk-11's `availability` endpoint, commits on tap, renders success / already-used / conflict states cleanly. Mounted on the public app at `/public/reschedule/:token`.
- Web (groomer): detail-drawer gets a new `RecurringBadgeRow` (Pause series / Resume series button). `use-calendar-mutations` adds `pauseSeries` + `resumeSeries`.
- Env / scripts: `RESCHEDULE_TOKEN_SECRET` added to `.env.example` + `loadEnv()`. New `pnpm --filter @mygroomtime/api dev:fire-materialization` script bypasses BullMQ and invokes the walker directly for local dev. Chunk-15's `dev:fire-reminder` script also registered in `apps/api/package.json` (was orphaned).
- Tests: +27 new — `reschedule-tokens.test.ts` (5), `materialize-series.test.ts` (7), `inbound-sms-dispatch.test.ts` (9), `routes/public/reschedule.test.ts` (5), `materialize-loop.integration.test.ts` (1). Pre-existing `reminder-schedule.test.ts` updated for the 7d kind. 268 → 295 API tests pass; 63 web tests still pass.

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
- **Twin Stripe.js stub** (chunk 12): real `loadStripe()` is hardcoded to js.stripe.com and can't reach the local twin. The web detects `pk_twin_` keys and renders a stub Payment Element that hits `/public/:slug/bookings/:id/twin-confirm`. The route 404s in live mode. Not a problem for dev but worth knowing if someone wires Apple Pay / Google Pay buttons (OOS v1) and expects them to work against the twin.
- **`confirmTwinPaymentIntent` on the adapter interface** (chunk 12): live mode throws on call. Kept on the interface for type unity. Only used by the twin-confirm route.
- **API tests require Docker** for Postgres on port 5433. `pnpm db:migrate` won't run without it. Web + twin tests are DB-free and run regardless.
- **`apps/web/src/routes/calendar/calendar.test.tsx`** is 405 LOC, 5 over the constitution's 400-LOC rule. Pre-dates chunk 12. Defer to a discrete cleanup chunk when other 400-LOC creep accumulates.
- **`vitest fileParallelism: false`** for `apps/api` (chunk 12): API tests share Postgres + signup-by-timestamp. Suite ~35s serial; if it grows past ~90s, fix the shared-state pattern and re-enable parallelism.
- **Tenant business hours hardcoded** Mon-Sat 8am-5pm in availability service. Tenant-configurable hours land in chunk 22.
- **Tenant TZ deferred to chunk 22.** Dashboard windows + payroll period boundaries currently run in server TZ. Multiple `// TODO chunk 22: tenant TZ` markers.
- **Refund tracking deferred to chunk 22.** Dashboard revenue + payroll splits do NOT subtract refunds yet. Markers in place.
- **Geocode twin coverage**: Plano/McKinney/Frisco only. Extend the zip-centroid table as scenarios demand.
- **Orphan-tenant sweep** (unpaid Tenants from abandoned signup) defers to chunk 22.
- **MutationLog 90-day retention sweep** defers to chunk 22.
- **Operator log UI** for failed jobs / dead-lettered webhooks / failed Stripe balance captures / `needsReauth` GoogleCalendarLinks / system-paused RecurringSeries / geocode failures — chunk 22 is when this lands.
- **Sentry not yet wired** (web + api). Chunk 22.
- **Customer-facing `/public/manage/:token` "Coming soon"** — chunk 17 added the real signed-token UX at `/public/reschedule/:token` for recurring reminders. The chunk-12 public booking confirmation page still links to the legacy `/public/manage/...` route which is unused. Either rewire that link to the reschedule flow or remove it — chunk 22 polish.

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
| chunk 16 → 17 | chunks 17/18/19 were claimed-but-uncommitted on arrival; reconstructed as the `chunks 17 to 19` bundled commit. Discipline lesson: verify recap commits with `git log` before greenlighting next chunk. |
| chunk 19 → 20 | Queue-name isolation for tests: `createReminderQueue` / `createReminderWorker` now take an optional `queueName`; `makeTestReminderInfra` generates `sms-reminders-test-{pid}-{random}` per call. Without this, a long-running `pnpm dev` worker holds `BZPOPMIN` on `sms-reminders` and grabs test jobs first → 4 flaky reminder-worker timeouts. After fix: 5/5 pass in 1.3s. |
| chunk 20 → 21 | Chunk 20 was uncommitted on arrival despite recap claim; committed as `98450d1` before chunk 21 started. Same pattern as the chunks-17-to-19 lesson. |

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
