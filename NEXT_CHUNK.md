# Next chunk — paste-ready prompt

This file holds the **next chunk prompt**, written by the project lead and ready to paste into a fresh agent session.

When this chunk is done and evaluated:
1. Move the prompt below into `CHUNK_LOG.md` history (as a recap entry, not the full prompt).
2. Replace this file's contents with the **next** next chunk prompt — OR delete it if this was the final chunk.
3. Commit.

---

## Chunk 22 — Operator log + admin polish + production readiness

**Route this to `/senior-engineer`.** Final v1 chunk. Lots of disparate items, all related (production readiness is many small things). After this lands and is committed, the human evaluator runs the 8 holdout scenarios per `SCENARIO_RUBRIC.md` and scores each 0-10; all must score 8+ to declare v1 done.

**Before pasting:** verify chunks 1-21 are committed and your working tree is clean. `pnpm preflight && pnpm dev` should be running.

```
/senior-engineer

Implement chunk 22 of MyGroomTime — operator log + admin polish + production readiness. This is the final v1 chunk.

CONTEXT
- Chunks 1-21 landed and committed. Verify chunk 21 commit is present.
- READ THESE FILES, IN THIS ORDER:
    CHUNK_LOG.md
    spec/constitution.md
    spec/architecture.md
    spec/product.md
    spec/plan.md          (chunk 22 only)
- DO NOT READ:
    scenarios/   ← these get evaluated AFTER your work lands, by a human evaluator per SCENARIO_RUBRIC.md. They're still the holdout test set; reading them now invalidates the quality signal.
    twins/*.md
- Existing patterns to mirror: chunk-15 worker shape + chunk-19 dashboard service layout + chunk-20 settings page UX.

POLICY DECISIONS (locked)
- **Operator log = six curated categories** (NOT every error):
    1. Dead-lettered BullMQ jobs (gcal-push, gcal-pull, reminder, materialize) — past max attempts
    2. Failed webhook processing (`WebhookEvent.status='error'` past 5 retries)
    3. Failed Stripe balance captures (`status='completed' AND balanceChargeId IS NULL AND depositChargeId IS NOT NULL AND completedAt < now - 24h`)
    4. `GoogleCalendarLink.needsReauth = true`
    5. `RecurringSeries.pauseReason = 'no_available_slot'` (system-paused, owner action required)
    6. Geocode failures (`Client.addressVerified=false` past 3 retries)
  Each entry has: acknowledged toggle, retry action where applicable (job retry, balance recapture, geocode retry, OAuth reconnect link), category badge.
  Bulk acknowledge per category. Resolved entries hidden by default with a "show resolved" toggle.
- **NOT in the log**: opted-out SMS, tier-gated SMS, normal customer cancellations, manual no-shows. These are expected business outcomes.
- **Tenant TZ**: add `Tenant.timezone` IANA string (e.g. `America/Chicago`). Default `'UTC'` for grandfathered rows. New onboarding asks for it. Use `date-fns-tz` for math (small, well-maintained). Affects: payroll period boundaries, dashboard windows, recurring 1-week-prior SMS fire time, post-appointment review fire time, system-wide "today" semantics.
- **Refund model**: new table `Refund(id, tenantId, appointmentId, stripeRefundId, amountCents, reasonCode, reasonNote?, createdByUserId, createdAt)`. Reason codes enum: `customer_request | quality_issue | scheduling_error | other`. Refund is full-charge-or-fixed-amount only — no partial-tip-only in v1.
- **Refund effects on existing data**:
    - Payroll: subtracts refund amount from the groomer's revenue in the period where the refund was issued (NOT the period of the original appointment — refunds count against current period for cash-flow accuracy)
    - Dashboard revenue: subtracts refunds (gross_revenue - refunds = net_revenue; show both)
    - Appointment detail: shows refund history (list)
- **Rate limits**: apply to /auth/login, /auth/magic-link/request (chunks 3 already partial), /public/* (chunk 11 already partial), AND /webhooks/* (new — per-IP per-source-route 600 req/min — generous because Stripe/Twilio retries; defends against abuse). Use @fastify/rate-limit.
- **/healthz extended**: DB ping (one-shot SELECT 1), Redis ping, adapter mode echo (no live calls — just report which mode each adapter is configured for). Returns 503 if DB or Redis ping fails; 200 otherwise.
- **Sentry**: hook into web + api. PII redaction config covers: phone, email, address fields, OAuth tokens, Stripe keys, webhook bodies. Use Sentry's `beforeSend` to strip; verify in test.
- **Migration ramp policy**: every migration must be backwards-compatible with the previous-deployed code for one release cycle. Document the add-nullable → backfill → require pattern in `MIGRATIONS.md` at repo root. Any new chunk-22 migrations follow this discipline (the new ones can be straightforward since they're additive).
- **SLO targets** (documented in `OPERATIONS.md`, not enforced in code): API p95 < 500ms (chunk 19 already at <200ms), uptime 99.5%, error rate < 0.5% over 5min.
- **Audit log on appointment** (already mostly in place via timestamps + status enum) — add an explicit "Activity" tab on the appointment detail drawer that lists status transitions + who made them. Read from existing fields; no new table needed.

SCOPE — chunk 22
Fat chunk by necessity (production readiness is many small things, all related). If you judge it too wide, split as:
  22a — operator log + audit log + rate limits + Sentry + /healthz
  22b — tenant TZ + refund tracking + deploy/operations docs

Recap states which path you took.

Deliverables

== Schema ==

1. Migration `20260530000000_production_readiness`:
   - `Tenant`: add `timezone String @default("UTC")`
   - New table `Refund` (columns as above)
   - New enum `RefundReasonCode`
   - `OperatorLogEntry` table — id, tenantId, category enum, severity enum (info|warn|error), payload JSONB, acknowledgedAt nullable, acknowledgedByUserId nullable, retryCount int default 0, lastRetryAt nullable, createdAt
   - Indexes: `OperatorLogEntry(tenantId, acknowledgedAt, createdAt)` for the default view
   - Backfill: existing data doesn't need migration; the operator log starts empty and accumulates entries as new failures occur. Don't synthesize entries from existing failed jobs (would be misleading).

== Operator log infrastructure ==

2. `apps/api/src/services/operator-log.ts`
   - `recordOperatorLogEntry({ tenantId, category, severity, payload })` → upserts entry (dedupe on a stable key derived from category + payload identity, e.g. `dead-letter-job:{queueName}:{jobId}` so the same job doesn't double-log on multiple retries)
   - `acknowledgeEntry({ entryId, userId })` → sets acknowledgedAt + acknowledgedByUserId
   - `retryEntry({ entryId, userId })` → category-aware retry path (re-enqueue dead job, retrigger balance capture, retry geocode, generate new OAuth link)
   - Tests for each category retry path

3. Wire `recordOperatorLogEntry` into the existing failure paths:
   - BullMQ worker `failed` event when `attemptsMade >= attempts` (chunks 14, 15, 17, 20)
   - WebhookEvent error past 5 retries (chunks 10, 14, 20)
   - Failed Stripe balance capture (chunk 16.5 complete-flow)
   - `GoogleCalendarLink.needsReauth=true` transition (chunk 20)
   - `RecurringSeries.pauseReason='no_available_slot'` transition (chunk 17)
   - Geocode retry exhaustion (chunk 6)

== Operator log routes + UI ==

4. `apps/api/src/routes/operator/`
   - GET /operator/entries?category=&acknowledged= — paginated list
   - POST /operator/entries/:id/acknowledge
   - POST /operator/entries/:id/retry
   - POST /operator/entries/bulk-acknowledge — body { ids: [] } or { category, beforeDate }
   - All require requireAuth + role='owner' (no dispatchers, no groomers)

5. `apps/web/src/routes/operator/index.tsx` — entries list grouped by category, filter pills, acknowledge + retry actions. Mobile-friendly but desktop-primary (operator work).

== Tenant TZ ==

6. `apps/api/src/services/tenant-tz.ts`
   - `inTenantTz({ tenantId, date })` → returns date-fns-tz-zoned helpers (startOfDay, addDays, etc.)
   - Per-tenant cache (tz rarely changes; OK to cache for the request lifetime)

7. Refactor chunk-19 dashboard + chunk-21 payroll + chunk-15 recurring SMS fire time + chunk-17 1-week recurring SMS to use tenant TZ. Update the existing TODO markers. Tests must use a tenant with a non-UTC timezone to assert period boundaries cross at the right wall-clock moment.

8. Onboarding flow (chunk 22 polish): add tz picker to the post-signup onboarding sequence. Default to browser tz via `Intl.DateTimeFormat().resolvedOptions().timeZone`. Stores into `Tenant.timezone`.

== Refund tracking ==

9. `apps/api/src/routes/appointments/refunds.ts`
   - POST /appointments/:id/refunds — body { amountCents, reasonCode, reasonNote? }. Validates: appointment status=completed AND has `balanceChargeId` OR `depositChargeId` AND amountCents ≤ total captured. Stripe refund via existing adapter. Creates Refund row.
   - GET /appointments/:id/refunds — list

10. Update chunk-19 dashboard revenue: net = gross - refunds in period. Render both numbers ("$X gross, $Y net").

11. Update chunk-21 payroll: subtract refunds from groomer revenue in period of issuance (not of original appointment). New CSV column `refunds_cents`.

12. Web: refund button on completed appointment detail drawer. Confirmation modal with amount + reason picker.

== Rate limits ==

13. Extend rate limit config on /webhooks/stripe, /webhooks/twilio, /webhooks/google-calendar — 600 req/min per source IP. Whitelist Stripe/Twilio/Google's documented IP ranges if straightforward (don't worry if it's a lot of work — generous default rate is fine for v1).

== Sentry ==

14. Install @sentry/node + @sentry/react. Initialize in apps/api/src/server.ts and apps/web/src/main.tsx.
15. `beforeSend` config strips PII: any event payload field matching `phone | email | street | city | zip | passwordHash | refreshToken | accessToken | clientSecret | secretKey | webhookBody`.
16. Tests verify the redaction (synthetic event with PII → assert post-beforeSend has redactions in place).
17. SENTRY_DSN_API + SENTRY_DSN_WEB env vars. If unset (dev): Sentry init is a no-op.

== /healthz extended ==

18. Replace existing /healthz with a richer payload:
    {
      status: 'ok' | 'degraded' | 'down',
      checks: { db: 'ok|fail', redis: 'ok|fail' },
      adapters: { stripe: 'live|twin', twilio: ..., gcal: ..., gmaps: ..., geocode: ... },
      ts: ISO
    }
   - 200 if all checks pass, 503 if any fail. 'degraded' status not used in v1 — binary.

== Audit log UI (existing data, new presentation) ==

19. `apps/web/src/routes/calendar/detail-drawer.tsx` — add an "Activity" tab showing status transitions chronologically. Source: the existing timestamps (scheduledAt, onTheWayAt, startedAt, completedAt, canceledAt, noShowAt) + the user who triggered each (NOT tracked yet at row-level — add `transitionedByUserId` columns to Appointment in the same migration as everything else, populated going forward; historical entries show "system" if null).

== Deploy + operations docs ==

20. `DEPLOY.md` at repo root:
    - Fly.io: `fly deploy` flow, secrets management, rollback via `fly releases` + `fly deploy --image=...`
    - Vercel: git-driven, rollback via Vercel dashboard or `vercel rollback`
    - Neon: branch-per-env, migrations via Prisma in CI
    - Upstash: connection string per env
    - DNS: `*.mygroomtime.com` CNAME to Vercel; `api.mygroomtime.com` to Fly

21. `OPERATIONS.md` at repo root:
    - SLO targets (above)
    - On-call runbook: how to investigate /healthz failures, how to drain the BullMQ queue, how to retrigger a stuck webhook
    - Common operator-log entries + remediation steps

22. `MIGRATIONS.md` at repo root:
    - Backwards-compatibility policy (nullable → backfill → required)
    - How to write a safe migration
    - Reverting policy (don't auto-revert; new migration that reverses)

== Env ==

23. Finalize `.env.example` — every var documented with one-line "what is this." Add the new ones: SENTRY_DSN_API, SENTRY_DSN_WEB.

== Pre-launch scenario evaluation ==

24. DO NOT YOURSELF run scenarios. They're holdout — the human evaluator runs them against your finished build per SCENARIO_RUBRIC.md. Your job ends at "I shipped chunk 22 and everything else is green."

CONSTRAINTS (constitution)
- No file over 400 LOC.
- TS strict.
- No mention of Claude/Anthropic/OpenAI/Copilot anywhere — code, configs, commits, docs.
- Light mode default; mobile-first for operator log (usable on phone but desktop-primary).
- All external calls via adapters.
- Customer PII never logged. The Sentry redaction config is the canonical list — keep it synced with pino redact.
- All money in cents.

DONE WHEN
- Operator log captures + surfaces all 6 categories; bulk-acknowledge works; retry works for each retryable category
- Tenant TZ changes payroll period boundaries to wall-clock-local for non-UTC tenants (verified by test)
- Refund route + UI works against Stripe twin; payroll + dashboard reflect refunds correctly
- Sentry initializes; PII redaction verified in test
- /healthz returns 503 when DB or Redis is down (simulate by pointing to a bad URL); 200 with full payload otherwise
- Rate limits: 11th rapid login attempt → 429; webhook rate limits don't false-positive on legitimate Stripe retries (verify via tester replaying a real webhook 5x in 10s — should all succeed)
- Audit log "Activity" tab renders on the appointment detail with the right timeline
- DEPLOY.md, OPERATIONS.md, MIGRATIONS.md all present and accurate
- `.env.example` fully documented
- All 377+103+10 chunk-21 tests still pass + new chunk-22 tests
- pnpm typecheck ✅ / pnpm lint ✅ / pnpm test ✅
- pnpm preflight && pnpm dev still up; /operator route reachable for owner role only

OUT OF SCOPE
- 1099 / W-2 generation (v2)
- Multi-currency
- Apple Pay / Google Pay
- Customer self-service refund (v2)
- Live chat / support widget (v2)
- A/B testing infrastructure (v2)
- Analytics tracking beyond Sentry errors (v2)
- Backup automation (Neon does this; document, don't build)
- HA across regions (Fly single-region is v1 enough)
- Compliance certifications (SOC2, HIPAA) — v2+

WHEN DONE
Recap in <20 lines:
- Whether you shipped 22 as one chunk or split 22a/22b
- Files added per area (schema / services / routes / web / docs)
- Operator log dedupe key strategy for each of the 6 categories
- Tenant TZ refactor: which existing services were the trickiest to convert (esp. recurring SMS fire time)
- Refund effect on payroll: did the "refund counts against period of issuance, not of original appointment" rule need extra plumbing or did it fall out naturally
- /healthz behavior on partial failure: any case where one check fail caused the whole endpoint to time out (need to parallelize)
- Sentry beforeSend: any field that turned out to need redaction that wasn't on the original list
- Rate limit on webhooks: did legitimate Stripe replay traffic ever trip 429 in your testing
- All 8 scenarios — DO NOT RUN THEM YOURSELF. State explicitly that they're pending human evaluation per SCENARIO_RUBRIC.md.
- One sentence on whether you believe v1 is ready to ship to private beta.

Hold for eval. This is the last chunk.

Once eval passes:
1. Human evaluator runs all 8 scenarios per SCENARIO_RUBRIC.md and scores each 0-10
2. Any scenario scoring <8 → diagnose (spec ambiguous, build wrong, or scenario wrong) and re-iterate
3. When all 8 score 8+, v1 is done.
```

---

## After chunk 22

v1 is shipped. There is no chunk 23 in `spec/plan.md`. Delete this file OR replace it with the first v2 chunk prompt if you start a v2 build.
