# Scenario evaluation rubric

After chunk 22 lands and the build claims "v1 ready," the human evaluator (you) runs the 8 holdout scenarios in `scenarios/` against the live system and scores each 0-10.

**v1 is done when every scenario scores 8 or higher.**

This file is the evaluator's process doc. The building agent must NOT read it (same rule as `scenarios/` — it would leak intent).

---

## Scoring methodology

For each scenario:

1. Read the scenario `.md` file end-to-end. The Satisfaction criteria section is your checklist.
2. Boot a fresh local stack (`pnpm preflight && pnpm dev`, plus the relevant twins for the scenario — see per-scenario notes below).
3. Drive the scenario from a real browser (375x812 viewport when the scenario specifies mobile; desktop otherwise).
4. For each Satisfaction criterion: ✅ met, ⚠️ partially met, ❌ failed.
5. Compute the score as **(met × 1.0 + partial × 0.5) / total × 10**, rounded down.
6. Score 9-10 = ship. 6-8 = note friction, ship if no ❌ blockers. 0-5 = block ship; diagnose root cause.

Floor rule: **any single ❌ on a Satisfaction criterion caps the score at 7**, regardless of arithmetic. Critical paths can't have known-broken pieces.

---

## Failure triage order

When a scenario scores below 8, work down this list:

1. **Was the spec ambiguous?** Re-read the spec section that the scenario exercises. If the agent had no way to know what "right" looked like, fix `spec/product.md` or `spec/architecture.md` and ask for a follow-up chunk to align the build. **Most common cause** in greenfield builds.
2. **Did the build miss it?** The spec was clear, the build didn't implement it. Write a chunk-22.x follow-up prompt with the specific gap.
3. **Was the scenario wrong?** Last resort. Be skeptical of yourself here — most "scenario was wrong" calls are actually "spec was ambiguous and the scenario inherited that ambiguity." Fix the scenario only when there's a concrete factual error (e.g., the scenario specifies $20 but the spec everywhere else says $25).

---

## Pre-flight before running any scenario

```bash
# In repo root
git pull origin main          # ensure you're on the chunk-22-committed HEAD
pnpm i                        # in case anything new landed
pnpm preflight && docker compose up -d
pnpm --filter @mygroomtime/db db:migrate
pnpm --filter @mygroomtime/db db:seed
pnpm dev                      # leave running in one terminal
```

Twins to start (separate terminals, only the ones the scenario needs):

```bash
pnpm twin:gmaps       # scenarios 02, 03, 04, 05
pnpm twin:geocode     # scenarios 01, 02
pnpm twin:stripe      # scenarios 01, 02, 06, 07, 08
pnpm twin:twilio      # scenarios 03, 04, 06
pnpm twin:gcal        # scenario 03 (if you choose to exercise the Pro+ sync path)
```

Open two browser windows:
- **Groomer app**: `http://localhost:5173` (sign in as the seeded owner)
- **Public booking**: `http://demo.localhost:5173` (Chrome/Firefox; no hosts edit needed)

---

## Per-scenario evaluator notes

### 01 — Owner signup and first appointment

**What to drive:**
- Open a new private browser window. Visit `localhost:5173`.
- Walk through signup → onboarding → first client → first appointment exactly as the scenario describes.
- Use real-ish address strings; verify the geocode twin returns coordinates inside the Plano envelope.

**Watch for:**
- Stripe Checkout return URL preserves onboarding progress (no back-to-start).
- Subdomain availability check is live, not on submit.
- Default service menu pre-fills (don't make Maria type "Full Groom" from scratch).
- Optimistic appointment insert on calendar.

**Common ❌:** "Start free trial" copy in the scenario — the v1 product has no trial (locked in chunk 10 policy). When you hit this, update **scenario 01** (not the product), changing "Start free trial" → "Start your subscription." Document in CHUNK_LOG.

---

### 02 — Anonymous dog owner books online with deposit

**Setup**: Maria (demo tenant) is Pro tier, has Stripe Connect onboarded (use `?auto=1` on the twin's Connect link to fast-path it), and has at least one Full Groom service with a non-zero deposit.

**What to drive:**
- Visit `demo.localhost:5173` in a private window.
- Pick Full Groom, pick tomorrow at 12pm (verify 11am is NOT available because of drive-time math from the seeded 10am appointment).
- Use address `4567 Elm St McKinney 75070` (outside service area zip list).
- Submit. The twin Stripe Payment Element should auto-complete on click (or `?auto=1` URL append).

**Watch for:**
- Outside-service-area handling: scenario flags this as a spec gap. Either the page rejects the address with a clear message OR allows with a "may decline" disclosure. Whichever you see, confirm it's explicit, not silent.
- Confirmation page renders "Booked!" even if the webhook is delayed (the polling logic from chunk 12).
- Manage link in SMS works without login (jti-protected route from chunk 17).
- New appointment appears on Maria's calendar within a few seconds.

**Common ⚠️**: if SMS confirmation hasn't been wired or twilio twin isn't running, the SMS criterion will be ⚠️. Email confirmation should still fire (visible in api stdout).

---

### 03 — Groomer runs a 6-appointment day from her phone

**Setup**: seed 6 appointments today across Plano addresses. Use the dispatch view if testing Business tier; route view otherwise.

**What to drive:**
- Open `localhost:5173` on a 375x812 simulated viewport (Chrome DevTools).
- Verify route view is the default landing during business hours (or accessible in 1 tap).
- Tap through "On the way" → "Started" → "Complete" for the first appointment.
- Test tip prompt (no default selection — explicit tap required).
- Test rebook prompt (interval pre-selected if a series exists).
- Mid-day: cancel an appointment. Watch for the dollar-amount confirm dialog ("Refund $20.00?").
- After cancel, route should recompute within ~10s.

**Watch for:**
- Battery: app doesn't poll faster than every 30s when idle.
- Tap targets ≥44px throughout.
- 2h-ETA SMS fires on "On the way" tap (twilio twin should show it).
- Tip prompt: no pre-selected value, "skip" is one tap.

---

### 04 — Recurring series fires 1-week-prior SMS and rebook works

**Setup**: complete an appointment, choose "Rebook in 6 weeks" — this creates a `RecurringSeries` and the next concrete appointment 6 weeks out.

**What to drive (chunk 17's `dev:fire-materialization` + `dev:fire-reminder` scripts make this practical):**
- Manually fire materialization for "now + 5 weeks" to land the materialized appointment.
- Fire the `reminder-7d` for the materialized appointment.
- Watch the twilio twin for the SMS.
- Simulate the customer replying "R" via `curl -X POST http://localhost:4243/__twin_inbound -H 'content-type: application/json' -d '{"from":"<phone>","body":"R"}'`.
- The api replies with the reschedule URL. Open it in a private window.
- Pick a new slot, confirm.

**Watch for:**
- The 1-week-prior SMS uses the tenant's business timezone (chunk 22 wires tenant TZ; pre-chunk-22 it's server UTC — note as ⚠️ if not yet fixed).
- "R" matches case-insensitively, trimmed.
- Reschedule link single-use (visiting again shows "this link has been used; your appointment is on...").
- Deposit NOT re-charged on reschedule (materialized appointments don't have a `depositChargeId` to begin with; if you started from a publicly-booked source, verify the existing `depositChargeId` carries over).
- "STOP" reply opts out the client globally for this tenant.

---

### 05 — Offline during route

**Setup**: load the day view with at least 3 appointments visible. Confirm cached.

**What to drive:**
- Chrome DevTools: Network tab → Offline.
- Tap "Started" on appt 1. UI should show optimistic update + offline banner ("Offline — 1 change queued").
- Tap "Complete" → tip → submit. "Offline — 2 changes queued."
- Tap "On the way" on appt 2. "Offline — 3 changes queued."
- Restore network. Replay drains in client-creation order.
- Verify the offline banner fades to "All caught up."

**Watch for:**
- Mutation queue persists across app close/reopen (close the tab while offline, reopen, verify changes are still queued).
- Stripe is called exactly ONCE for the Complete (not double-charged across replay).
- Replay order matches tap order, not arbitrary.
- Buffer banner / "Last synced N min ago" footer renders during offline mode.
- Conflict UX surfaces correctly if you contrive a conflict (e.g., delete the appointment in another tab while offline).

---

### 06 — No-show + refund + opt-out

**Setup**: an appointment scheduled in the past 30 min (or fast-forward by manually editing `scheduledStart` in Prisma Studio).

**What to drive:**
- Open the appointment detail. Tap "Mark No-Show."
- Verify the confirm dialog states the deposit retention policy AND the dollar amount.
- Confirm. Status flips, noShowAt set, no-show SMS goes out.
- Simulate "STOP" reply via twilio twin admin endpoint.
- Verify `Client.smsOptOut=true` in Prisma Studio.
- Try to book again from the public page using the same phone — confirm the page either disables booking or warns "this number has opted out of SMS."

**Watch for:**
- No-show SMS includes "Reply STOP to opt out" (mandatory suffix).
- Webhook dedupe holds: replay the STOP twin webhook twice; only one `smsOptOut` flip, only one log entry.
- 30-day "no-show last 30 days" dashboard widget reflects the no-show.

---

### 07 — Tier upgrade and feature gate

**Setup**: a Starter tenant. Try to access a Pro-only feature.

**What to drive:**
- As Starter Maria, navigate to "Booking Page" — should see paywall (greyed preview + upgrade CTA).
- Hit the API endpoint directly with `curl` to verify it returns 403 with `reason: 'plan_required'`.
- Click "Upgrade to Pro." Confirm the proration preview modal renders with concrete dollar amounts.
- Complete the upgrade (twin auto-completes).
- Verify the previously-paywalled page becomes functional automatically (no manual reload required).
- Test downgrade: confirm the modal lists what will be lost (booking page, GCal sync, recurring).
- Confirm downgrade. Verify booking page returns 404 within ~1 min.

**Watch for:**
- Server-side enforcement (curl hits 403, not just UI hiding).
- Webhook idempotency (Stripe subscription.updated firing twice doesn't double-flip).
- Downgrade is non-destructive — re-upgrade restores everything.

---

### 08 — Stripe webhook replay

**Setup**: any payment_intent.succeeded that's already been processed.

**What to drive:**
- Use the Stripe twin's `__twin__/replay-event` endpoint to redeliver the same event id.
- Watch the api logs. Confirm signature verify first, dedupe via WebhookEvent UNIQUE, return 200 without re-processing.
- Verify no duplicate Appointment row, no duplicate SMS, no duplicate Stripe Connect transfer.
- Try POSTing a webhook with an invalid signature — confirm 400 + bail.
- Try concurrent delivery (script the same event id POST'd in parallel): exactly one effect.

**Watch for:**
- Webhook handler returns < 200ms p95 for the already-processed path (Stripe will time out otherwise).
- Raw payload retained for 30 days (verify in Prisma Studio).
- Dead-letter: after 5 failed attempts, the event lands in the operator log.

---

## After all 8 scenarios

Record results in a `SCENARIO_RESULTS.md` (commit it):

```markdown
# v1 scenario evaluation — YYYY-MM-DD

| Scenario | Score | Notes |
|----------|-------|-------|
| 01 owner signup | 9/10 | "Start free trial" copy fixed → "Sign up" |
| 02 public booking | 8/10 | Outside-area handling: chose allow-with-disclosure |
| 03 run the day | 9/10 | — |
| 04 recurring rebook | 8/10 | Tenant TZ now wired (chunk 22) |
| 05 offline | 9/10 | — |
| 06 no-show + STOP | 9/10 | — |
| 07 tier upgrade | 9/10 | — |
| 08 webhook replay | 10/10 | — |
```

If any score < 8: open a follow-up chunk (call it 22.1, 22.2, etc.) targeting the specific gap. Don't ship v1 until all 8 are at 8+.

When all 8 pass: **v1 is done.** Commit a final tag `v1.0.0` on main.
