# Build Plan — MyGroomTime

22 chunks, ordered by dependency. Each chunk is a vertical slice (data + endpoint + UI, where applicable) that lands in a working state. Don't move on until the chunk's scenarios score 8+.

Each chunk lists:
- **Type** — `trunk` (other code depends on it → `/senior-engineer`) or `leaf` (isolated → `/vibe-code`)
- **Touches scenarios** — which holdouts to run after this chunk
- **Done when** — observable criteria

---

## Phase 0 — Foundation (chunks 1-4)

### 1. Monorepo scaffold + tooling
**Type:** trunk
**Deps:** none
**Build:**
- `pnpm-workspace.yaml` with `apps/*`, `packages/*`
- `apps/web` — Vite + React + TS + Tailwind, blank "MyGroomTime" page
- `apps/api` — Fastify + TS, `/healthz` returns 200
- `packages/db` — Prisma init with empty schema, `prisma generate` script
- `packages/shared` — exports a placeholder Zod schema
- Turborepo (or just pnpm scripts) for `dev`, `build`, `lint`, `typecheck`, `test`
- `.env.example` at root, `.env` gitignored
- `docker-compose.yml` for Postgres + Redis (local)
- ESLint + Prettier + tsconfig strict
- README with `pnpm i && pnpm dev`
**Done when:** `pnpm i && pnpm dev` brings up web (5173), api (3000), Postgres (5432), Redis (6379). `curl localhost:3000/healthz` → 200. Browser at localhost:5173 shows blank page with "MyGroomTime".

### 2. Multi-tenant data model + Prisma schema
**Type:** trunk
**Deps:** 1
**Build:**
- Prisma schema for: `Tenant`, `User`, `Vehicle`, `Service`, `Client`, `Pet`, `Appointment`, `RecurringSeries`, `BookingPageRequest`, `SmsMessage`, `WebhookEvent`
- Every non-global table has `tenantId` indexed
- Seed script: one demo tenant, 5 clients, 8 pets, 3 services, owner user
- `db.forTenant(tenantId)` query wrapper in `packages/db/src/index.ts` — every non-global call goes through it
- ESLint rule (or runtime check in dev) flagging direct `prisma.client.findMany()` etc. without the wrapper
**Done when:** `pnpm db:reset && pnpm db:seed` produces a working DB. `db.forTenant(t).client.findMany()` returns 5; `db.forTenant(otherT).client.findMany()` returns 0.

### 3. Auth — email/password + session
**Type:** trunk
**Deps:** 2
**Touches scenarios:** all (everything sits on top of auth)
**Build:**
- `POST /auth/signup` — creates Tenant + owner User
- `POST /auth/login` — argon2id verify, issues session cookie (Redis-backed)
- `POST /auth/logout`
- `GET /me` — returns current user + tenant
- Fastify `preHandler` resolves session → attaches `{user, tenant}` to request
- `requireRole(role)` middleware
- Web: login/signup pages, auth context, redirect-to-login on 401
**Done when:** Signup creates a tenant and lands logged in. Logout clears session. Hitting any authed route without a session redirects to login.

### 4. Adapter scaffolding (stub all 4)
**Type:** trunk
**Deps:** 1
**Build:**
- `apps/api/src/adapters/{stripe,twilio,gcal,gmaps}/` each with `index.ts` exporting `create<X>Adapter(env)` returning a typed interface
- For now, `live.ts` calls real SDK, `twin.ts` calls twin URL. Both can be empty methods returning `Promise.reject(new Error("not implemented"))` — we'll fill them per chunk.
- Mode selection from env: `STRIPE_MODE=live|twin`, etc.
- Default in dev: all `MODE=twin`, twin URLs from `.env.example`
**Done when:** Importing any adapter and calling a method throws "not implemented" (proves wiring is correct; behavior comes later).

---

## Phase 1 — Calendar + clients (chunks 5-9)

### 5. Twin: Google Maps + adapter implementation
**Type:** leaf
**Deps:** 4
**Build:**
- `twins/google-maps/` — Express server implementing the contract in `twins/google-maps.md`
- `apps/api/src/adapters/gmaps/live.ts` and `twin.ts` — both call Distance Matrix, return normalized `{ durationSec, distanceM }`
- Unit-ish smoke: hit twin from adapter, get a number back
**Done when:** `pnpm twin:gmaps` brings up the twin. Adapter call from a Node REPL returns a duration. Live mode works with a real `GOOGLE_MAPS_API_KEY` (if present).

### 6. Clients + Pets CRUD (+ geocode adapter)
**Type:** trunk (scope grew — was leaf; geocode lifts it)
**Deps:** 3, 5 (adapter pattern proven)
**Touches scenarios:** 01, 02
**Build:**
- New: geocode twin server (`twins/geocode/`) per `twins/geocode.md` — runs on port 4246, same shape as gmaps twin
- New: geocode adapter (`apps/api/src/adapters/geocode/{index,types,live,twin,parse,fetch}.ts`) — methods: `geocode({ address }) → { lat, lng, formattedAddress, placeId }`
- New: GEOCODE_MODE / GEOCODE_TWIN_URL / GEOCODE_TWIN_PORT env wiring, added to adapters bag (`fastify.adapters.geocode`)
- API: `GET/POST/PATCH/DELETE /clients`, nested `/clients/:id/pets`
- Geocode runs on client create/update when address changes; stores resulting lat/lng on Client. If geocode fails (ZERO_RESULTS), surface a friendly error and let the user save with an "address unverified" flag (don't block save — they can fix later)
- Web: clients list page, client detail page, pet card UI, new-client form (mobile-first)
- Validation via shared Zod schemas
**Done when:** Can add a client with a pet from mobile UI in <30s. Address geocodes to lat/lng on save. Data persists. Geocode failure handled gracefully.

### 7. Services CRUD
**Type:** leaf
**Deps:** 3
**Touches scenarios:** 01
**Build:**
- API: `GET/POST/PATCH /services`
- Default service templates seeded on tenant creation (Full Groom, Bath & Brush, Nail Trim)
- Web: services settings page, color picker, duration & price & deposit inputs
**Done when:** Owner can list, add, edit, soft-delete services. Color picks render correctly on the calendar (when calendar exists).

### 8. Calendar shell — day/week/month views
**Type:** trunk
**Deps:** 6, 7
**Touches scenarios:** 01
**Build:**
- API: `GET /appointments?from=&to=` — tenant-scoped, returns appointments in range
- Web: calendar component with day/week/month toggle. Mobile-first: day view is default on phone.
- Color-coded by service. Tap a slot → opens "new appointment" sheet.
- Tap an appointment → opens detail drawer.
- NO drag-to-reschedule yet, NO route view yet — pure read + create.
**Done when:** Empty calendar renders on phone. Tap-to-create appointment flow works end to end. Created appointment appears immediately (optimistic update).

### 9. Drag-to-reschedule + blackout windows
**Type:** trunk
**Deps:** 8
**Touches scenarios:** 03
**Build:**
- Drag handle on appointments (touch + mouse). Drop → `PATCH /appointments/:id { start }`
- Server validates: new slot doesn't overlap, drive-time from previous appointment doesn't conflict
- "Blackout" rendering: drive-time gaps before/after appointments are shown as light-gray non-droppable zones
- Conflict on server returns 409 with a structured reason; UI reverts the drag with toast
**Done when:** Can drag a 9am appt to 10am; it persists. Trying to drag onto a blackout shows a clear refusal.

---

## Phase 2 — Public booking + Stripe (chunks 10-13)

### 10. Twin: Stripe + Stripe Connect + subscription billing
**Type:** trunk
**Deps:** 4
**Touches scenarios:** 02, 07, 08
**Build:**
- `twins/stripe/` — Express server implementing the contract in `twins/stripe.md`. Customer create, Checkout, Connect, payment intents, webhooks, replay endpoints.
- `apps/api/src/adapters/stripe/` — full implementation (subscription, connect, payment intent, refund)
- `POST /webhooks/stripe` route — signature verify, dedup via `WebhookEvent.eventId UNIQUE`, route to handlers
- Subscription billing wired: signup → Checkout → webhook flips `Tenant.plan`
**Done when:** Can sign up, run through twin's auto-completing Checkout, end up with `Tenant.plan='starter'`. Replaying the same webhook does NOT double-flip. Scenario 08 passes.

### 11. Public booking page — read-only first
**Type:** leaf
**Deps:** 7, 8
**Touches scenarios:** 02
**Build:**
- Subdomain routing: `*.mygroomtime.com` → resolve `Tenant` by slug → render booking page
- Web: public booking page renders service menu (read-only first iteration). Available slots fetched from `GET /public/:slug/availability?serviceId=&date=`
- Availability respects existing appointments + drive-time math (use gmaps adapter)
- NO booking submission yet — that's chunk 12.
**Done when:** `planopupspa.mygroomtime.com` (or local equivalent like `planopupspa.localhost:5173`) shows Maria's services and real availability.

### 12. Public booking — submit with deposit (Stripe Connect)
**Type:** trunk
**Deps:** 10, 11
**Touches scenarios:** 02
**Build:**
- `POST /public/:slug/bookings` — creates `BookingPageRequest`, creates payment intent on Connect account
- Web: Stripe Payment Element inline. On confirm, poll booking status → confirmation page on success
- Webhook `payment_intent.succeeded` → promotes `BookingPageRequest` → `Appointment`, fires confirmation SMS/email jobs
- Confirmation page works even if webhook hasn't arrived yet (treats payment intent status as authoritative)
**Done when:** Carlos in scenario 02 can book end-to-end against the twin. Deposit ends up on Maria's connected account. Appointment appears on her calendar within seconds.

### 13. Tier gating + upgrade/downgrade flow
**Type:** trunk
**Deps:** 10
**Touches scenarios:** 07
**Build:**
- `Tenant.plan` enum: `starter | pro | business`
- Server-side `requirePlan('pro')` middleware on Pro+ routes (booking page write, recurring, etc.)
- 403 with structured `{ error: 'plan_required', required_plan, current_plan }`
- Web: paywall component renders on 403 from a "plan-gated" API. Upgrade modal hits Stripe subscription update.
- Downgrade modal lists what will be lost, hits subscription update, server reacts on webhook to hide gated features (e.g., booking page returns 404)
**Done when:** Scenario 07 passes. Starter user can't write to booking page API; Pro user can.

---

## Phase 3 — SMS + routing (chunks 14-16)

### 14. Twin: Twilio + adapter + outbound SMS
**Type:** trunk
**Deps:** 4
**Touches scenarios:** 02, 03, 04, 06
**Build:**
- `twins/twilio/` — Express server implementing `twins/twilio.md`
- Adapter: `live.ts` (twilio-node), `twin.ts` (HTTP fetch). Both expose `sendSms({to, body, statusCallback})` returning `{sid}`
- `POST /webhooks/twilio/status` — receives status callbacks
- `SmsMessage` rows logged on send + status update
- Booking confirmation SMS (chunk 12) is rewired to use this adapter
**Done when:** Booking flow sends SMS via twin. Status callback arrives. `SmsMessage.status` updates from `queued` → `delivered`. Real Twilio works with creds.

### 15. Scheduled SMS jobs (BullMQ) — 48h, 2h, post-appt
**Type:** trunk
**Deps:** 14
**Touches scenarios:** 03, 04
**Build:**
- BullMQ queues for `sms-outbound`
- On appointment create: schedule 48h-reminder job
- On "On the way" tap: enqueue 2h-ETA SMS (immediate)
- On "Complete" tap: enqueue post-appointment review SMS
- Jobs are idempotent (job key = appointmentId + kind). Cancel/reschedule cancels pending jobs.
- Templates: `templates/sms/*.txt` with {{vars}}, rendered tenant-specific
**Done when:** Booking an appt 50h out enqueues a 48h job. Marking "On the way" sends a 2h SMS immediately. Marking complete sends a review request. All visible in `SmsMessage` log.

### 16. Route optimization + day route view
**Type:** trunk
**Deps:** 8, 15
**Touches scenarios:** 03
**Build:**
- API: `GET /appointments/today/route` — returns appointments + computed optimal order + drive times
- Algorithm: nearest-neighbor heuristic from depot (tenant's start location). Good enough for v1; flagged in code as "swap for 2-opt later if needed."
- Web: route view as the default landing screen during business hours (8am-6pm). Toggle to calendar.
- Route recomputes job (`route-recompute` queue) fires on appointment add/move/cancel for today.
- Live ETA link in 2h SMS: lightweight page showing static ETA (no real GPS yet).
**Done when:** Scenario 03 passes. Route view loads in <1s. Drag/cancel triggers recompute within 10s.

---

## Phase 4 — Recurring + offline + dashboard (chunks 17-19)

### 17. Recurring appointments
**Type:** trunk
**Deps:** 8, 15
**Touches scenarios:** 04
**Build:**
- `RecurringSeries` model usage: created from "rebook in N weeks" prompt on appointment complete
- Nightly job `recurring-rebook` materializes concrete appointments 14 days out
- 1-week-prior SMS scheduled at materialization time
- Inbound SMS reply handler: "C" → confirm (no-op, log), "R" → generate signed reschedule link, send back
- Public reschedule page (reuses booking page UX, pre-filled, deposit credited)
- STOP reply sets `Client.sms_opt_out`
**Done when:** Scenario 04 passes. Scenario 06's STOP path also works (overlaps).

### 18. Offline support (PWA, today's route cache, mutation queue)
**Type:** trunk
**Deps:** 16
**Touches scenarios:** 05
**Build:**
- `vite-plugin-pwa` configured. Service worker caches today's route + assets.
- Mutation queue in IndexedDB: client-generated UUID per mutation, retry on reconnect with exponential backoff
- Server-side dedup via mutation UUID stored on resource
- Offline banner UX: discreet, neutral color, shows pending count
- Conflict screen for permanent failures on replay
**Done when:** Scenario 05 passes. Offline mode survives app close/reopen.

### 19. Owner dashboard
**Type:** leaf
**Deps:** 16, 17
**Build:**
- Today's route widget (link to chunk 16's view)
- Revenue widgets (day, week, month) — sum of completed appointments' final amounts
- No-show rate (last 30d)
- Top 5 clients by revenue (last 90d)
- Gaps to fill: open windows in next 7d where a regular's last cut was >their interval ago
- Each metric tappable → drills into list
**Done when:** Dashboard loads in <500ms with seed data. Numbers match hand-calculation.

---

## Phase 5 — Business tier + polish (chunks 20-22)

### 20. Twin: Google Calendar + two-way sync (Pro+)
**Type:** trunk
**Deps:** 4, 8
**Build:**
- `twins/google-calendar/` per contract
- OAuth flow (twin shortcut in dev, real Google in prod)
- Per-user `GoogleCalendarLink` table holding tokens
- On appointment create/update/delete in MyGroomTime → push to Google
- Watch channel + delta sync to ingest external changes
- Conflict resolution: last-write-wins
- Pro+ gated (chunk 13 middleware)
**Done when:** Pro user connects Google. Creating an appt in MGT pushes to Google calendar (twin or real). Creating in Google (via twin's `__twin__/external-event-created`) ingests.

### 21. Business tier: multi-vehicle dispatch + payroll splits
**Type:** trunk
**Deps:** 13, 16
**Build:**
- `Vehicle` model usage: assign appointments to vehicles
- Web: multi-column day view (one per vehicle), drag between columns
- Route recompute per vehicle
- Payroll splits report: revenue + tips per groomer for a date range, CSV export
- Business plan gating
**Done when:** Owner on Business can have 3 vans, drag appts between them, export a payroll CSV.

### 22. Operator log + admin polish + production readiness
**Type:** trunk
**Deps:** all
**Build:**
- `/operator` route (owner-role): failed jobs, dead-letter queue, payment edge cases (failed balance captures, disputes), webhook failures
- Retry buttons on failed jobs
- Sentry hooked up (web + api)
- `/healthz` extended: checks DB + Redis
- Rate limiting on public booking + auth endpoints (Fastify rate-limit plugin)
- Audit log surfaced on appointment detail (status transitions)
- `.env.example` finalized; deploy docs for Fly + Vercel + Neon + Upstash
- Smoke-run all 8 scenarios end-to-end. Document any that score <8 and fix before declaring v1.
**Done when:** All 8 scenarios score 8+. Sentry catches a deliberate error in staging. Rate limit kicks in on 11th rapid request.

---

## How to run the loop

For each chunk:

1. Open a fresh agent session. Brief it with: "Read `spec/`. Do not read `scenarios/` or `twins/*.md`. Implement chunk N from `spec/plan.md`."
2. Pick the right skill:
   - **trunk** chunks → `/senior-engineer`
   - **leaf** chunks → `/vibe-code`
3. Agent builds. Land the changes.
4. Run the listed scenarios. Score.
5. If any score <8: diagnose (spec? build? scenario?). Fix where it belongs. Re-run.
6. Mark the chunk ✅ and move on.

Don't run two chunks in parallel. Sequential, one agent at a time. Quality of spec > quantity of agents.
