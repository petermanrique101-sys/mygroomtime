# Next chunk — paste-ready prompt

This file holds the **next chunk prompt**, written by the project lead and ready to paste into a fresh agent session.

When this chunk is done and evaluated:
1. Move the prompt below into `CHUNK_LOG.md` history (as a recap entry, not the full prompt).
2. Replace this file's contents with the **next** next chunk prompt.
3. Commit.

---

## Chunk 12 — Public booking submission + Stripe Connect deposit

**Route this to `/senior-engineer`.** Trunk chunk — handles money, mounts on real Connect accounts, gates the chunk-11 booking page becoming useful.

**Before pasting:** verify chunk 11 is committed and your working tree is clean.

```
/senior-engineer

Implement chunk 12 of MyGroomTime — public booking submission with Stripe Connect deposit.

CONTEXT
- Chunks 1-11 landed and committed. CHUNK_LOG.md at repo root has the full history + cross-chunk policy decisions you must honor.
- READ THESE FILES, IN THIS ORDER:
    CHUNK_LOG.md
    spec/constitution.md
    spec/architecture.md
    spec/product.md        (flow 5 — dog owner books online; data model: BookingPageRequest, Appointment)
    spec/plan.md           (chunk 12 only)
    twins/stripe.md        ← EXCEPTION: allowed (extending the chunk 10 twin)
- DO NOT READ:
    scenarios/
    twins/twilio.md, twins/google-calendar.md, twins/geocode.md, twins/google-maps.md
- Existing patterns to mirror: chunk 10's Stripe twin + adapter + webhook handling; chunk 11's public routes + slot availability; chunk 6's geocode-on-save pattern.

POLICY DECISIONS (locked — don't ask, see CHUNK_LOG.md for the why)
- Re-validate slot with REAL customer coords at submit time before charging. canPlaceAppointment from chunk 9 is the single source of truth.
- Geocode customer address inline at submit; on ZERO_RESULTS surface a friendly error and refuse to create the BookingPageRequest (deposit page is the wrong place to "save with addressVerified=false").
- Stripe Connect onboarding: lazy — create the connected account on first time the owner opens /settings/payments (new). Onboarding link redirects to Stripe (twin auto-completes in dev), returns to /settings/payments.
- Tenant must have `stripeConnectAccountId` AND `stripeConnectChargesEnabled=true` before public booking submit is accepted. If chargesEnabled=false: booking page treats it like past_due (render services, disable Book, copy "This groomer is finishing payment setup — contact them directly").
- BookingPageRequest is the staging row created before payment confirms. Promoted to Appointment by the webhook handler on `payment_intent.succeeded`.
- Confirmation page is webhook-independent: polls payment_intent status; if `succeeded`, shows "Booked!" even before the appointment row exists yet (the webhook will catch up).
- Email confirmation via the existing stdout email adapter (chunk 22 will swap to SES). SMS confirmation is deferred — chunk 14 wires it. Leave a clear `// chunk 14: enqueue SMS confirmation` marker in the booking success handler.
- Deposit goes to the connected account via `transfer_data[destination]` on the payment intent (Stripe direct charge with destination). Application fee for the platform is 0 in v1 — flag a TODO for v2 when we monetize Connect.
- If the customer's number is already opted out of SMS (Client.sms_opt_out=true) — does this Client even exist yet at this point? No — the BookingPageRequest may not have a matching Client row. v1 logic: try to match by phone, link if found; create new Client if not. Match-or-create runs on webhook promote, not submit.

SCOPE — chunk 12
End-to-end public booking submission: customer fills form → server geocodes + re-validates → payment intent → Stripe Payment Element → webhook promotes to Appointment → confirmation page. Plus Stripe Connect onboarding for the owner side.

Deliverables

== Stripe twin extension ==

1. Extend twins/stripe to support the Connect flow + payment intent flow if not already complete from chunk 10:
   - POST /v1/accounts (create connected account) — already exists from chunk 10
   - POST /v1/account_links (onboarding URL that auto-completes) — already exists, verify auto-completion sets capabilities active
   - GET /v1/accounts/:id returns capabilities: { card_payments: 'active', transfers: 'active' } after auto-onboarding
   - POST /v1/payment_intents — supports transfer_data, application_fee_amount, on_behalf_of
   - Webhook events fired on payment_intent confirm: payment_intent.succeeded with the connected account id in the event

2. Verify the twin's webhook signature path supports both platform events and Connect events. If real Stripe sends Connect-account events to a different webhook endpoint by convention, mirror that — but for chunk 12 it's acceptable to send all events to /webhooks/stripe and dispatch internally.

== Stripe adapter (live implementations) ==

3. apps/api/src/adapters/stripe/live.ts — IMPLEMENT methods left throwing in chunk 10:
   - createConnectAccount({ email, country })
   - createConnectAccountLink({ accountId, refreshUrl, returnUrl })
   - getConnectAccount({ accountId }) → { id, chargesEnabled, payoutsEnabled }
   - createPaymentIntent({ amountCents, currency, connectedAccountId, metadata, idempotencyKey })
   - createRefund({ paymentIntentId, amountCents? })

4. Twin already implements all of these (or extend if missing).

5. Add tests: live + twin adapter integration for Connect onboarding + payment intent creation + refund.

== Schema additions ==

6. Migration: 20260517120000_connect_and_booking_requests
   - Tenant adds: stripeConnectAccountId String?, stripeConnectChargesEnabled Boolean @default(false), stripeConnectPayoutsEnabled Boolean @default(false), stripeConnectStatusUpdatedAt DateTime?
   - BookingPageRequest is already in the schema from chunk 2. Confirm it has:
       id, tenantId, serviceId, start, durationMin
       customer info: firstName, lastName, phone, email?, street, city, state, zip, lat, lng
       pet info: petName, breed, weightLb, coatType, temperamentNotes?, vaccinationExpiry?
       payment: stripePaymentIntentId, depositCents, status (pending_payment | succeeded | failed | expired | promoted)
       appointmentId (nullable, set when promoted)
       createdAt, expiresAt (default created + 30 min)
   - If chunk 2 didn't include the customer/pet fields, add them now.

== API routes ==

7. apps/api/src/routes/settings/payments.ts
   - GET /settings/payments — returns { connectAccountId, chargesEnabled, payoutsEnabled, onboardingUrl? }
     - If no account: returns { chargesEnabled: false, needsOnboarding: true }
     - If account exists but not chargesEnabled: returns onboardingUrl for resuming
   - POST /settings/payments/onboard
     - Lazy-create stripeConnectAccountId if missing
     - Generate account_links URL (refresh + return both go back to /settings/payments)
     - Return { url } to redirect the owner to
   - POST /webhooks/stripe handler extension:
     - Handle account.updated → update Tenant.stripeConnectChargesEnabled, etc.
     - Handle payment_intent.succeeded → promote BookingPageRequest (see below)

8. apps/api/src/routes/public/submit.ts — the big one
   POST /public/:slug/bookings
   Body: { serviceId, start, durationMin, customer: {...}, pet: {...} }

   Flow:
     a. resolve-public-tenant preHandler — must be pro/business, chargesEnabled=true (else 409 with reason)
     b. Validate input via shared Zod
     c. Look up service (active + not deleted)
     d. Geocode customer address. On ZERO_RESULTS: 400 with "Couldn't verify your address — please check the zip code." On REQUEST_DENIED/network: 502.
     e. canPlaceAppointment with real customer coords. On conflict: 409 with { reason, detail }. Conflict here means the slot was taken between page load and submit (race), or the customer's address pushes buffers into a conflict.
     f. Create BookingPageRequest with status=pending_payment, expiresAt=now+30min
     g. Create Stripe payment_intent on connected account:
         amount = service.depositCents (or service.basePriceCents if depositCents=0 — but if no deposit, why are we here? — actually if depositCents=0 then we skip the payment intent entirely and promote immediately? Or charge $0.50 minimum? Spec doesn't say. RECOMMENDED v1: services with depositCents=0 don't go through the public booking page at all — the Pro tier owner must set a non-zero deposit. Surface as a 409 if a $0 deposit service is requested through public booking: "this service requires direct booking — contact the groomer.")
         Use idempotency key = BookingPageRequest.id (so retried submits don't create multiple intents)
         metadata = { tenantId, bookingRequestId }
         transfer_data = { destination: tenant.stripeConnectAccountId }
         on_behalf_of = tenant.stripeConnectAccountId
     h. Update BookingPageRequest with stripePaymentIntentId
     i. Return { bookingRequestId, clientSecret }

9. apps/api/src/routes/public/booking-status.ts
   GET /public/:slug/bookings/:requestId/status
   - Returns { status, appointmentId? }
   - For polling on the confirmation page

10. Webhook handler extension: payment_intent.succeeded
    - Look up BookingPageRequest by stripePaymentIntentId
    - Match-or-create Client by phone within tenant
    - Match-or-create Pet under that Client (match by name + breed — fuzzy enough for v1; collisions are rare)
    - Create Appointment with snapshot fields populated from the service
    - Update BookingPageRequest status=promoted, appointmentId=new appt id
    - Enqueue email confirmation (use existing stdout email adapter)
    - Add a TODO comment: "// chunk 14: enqueue SMS confirmation"
    - Idempotency: handle replay (already-promoted booking request returns success without double-creating)

11. Cleanup job: expire pending_payment BookingPageRequests after 30 min (no payment intent succeeded). Status=expired. Don't create the appointment. The slot becomes available again.
    - For v1, run this inline as a cron-like check in the availability endpoint (lazy expiry); BullMQ job is overkill until chunk 17+ when we have more scheduled work.

12. Tests:
    - Submit happy path: form → geocode → conflict-free → payment intent → twin webhook auto-fire → Appointment created
    - Submit with already-taken slot: 409 conflict, no BookingPageRequest, no payment intent
    - Submit with bad address: 400, no DB writes
    - Submit when Connect not chargesEnabled: 409 with reason
    - Idempotency: same submit twice creates one BookingPageRequest + one payment intent (idempotency key)
    - Webhook replay: payment_intent.succeeded delivered twice → one Appointment, not two
    - Match-or-create Client: existing phone matches; new phone creates
    - Expiry: BookingPageRequest sitting pending_payment for 30+ min returns expired status on poll

== Web — owner side (Stripe Connect onboarding) ==

13. apps/web/src/routes/settings/payments.tsx
    - Card showing Connect status: "Not set up" | "Setup incomplete" | "Active"
    - "Set up payments" / "Continue setup" CTA → POST /settings/payments/onboard → redirect to Stripe onboarding URL
    - Return URL handling: on landing back, GET /settings/payments to refresh status; show success state if chargesEnabled
    - Add link to /settings/payments in the settings navigation

== Web — public booking submit ==

14. apps/web/src/routes/public/book/[serviceId]/details.tsx
    - REPLACE the chunk 11 placeholder "coming soon" page
    - Form: customer (name, phone, email, full address) + pet (name, breed, weight, coat type, temperament notes optional, vaccination expiry optional)
    - Form validates via shared Zod schemas before submit
    - On submit: POST /public/:slug/bookings → receive { bookingRequestId, clientSecret }
    - Render Stripe Payment Element using clientSecret
    - On Payment Element confirm:
        - Stripe handles the card capture
        - Navigate to /public/booked/:requestId
    - On submit error (slot conflict, geocode fail): inline error + form stays filled

15. apps/web/src/routes/public/booked/[requestId].tsx
    - Poll GET /public/:slug/bookings/:requestId/status every 1.5s (max 30s)
    - Treat payment_intent status as authoritative — if status='succeeded' or 'promoted', show "Booked!" immediately, don't wait for the appointment row
    - Show: appointment summary (service, date+time, address-on-file), "Manage booking" link (signed token URL — chunk 17 implements the manage UI; for chunk 12 it can 404 with "coming soon" copy and the booking is still valid)
    - On timeout: "Payment confirmed — we're still setting up. Refresh in a moment." copy

16. Stripe.js setup:
    - Install @stripe/stripe-js and @stripe/react-stripe-js
    - Stripe publishable key from env: STRIPE_PUBLISHABLE_KEY (live) / STRIPE_TWIN_PUBLISHABLE_KEY (twin — any string is fine since twin doesn't validate)
    - Initialize the Stripe instance with the connected account: stripe.elements({ clientSecret, appearance: {...} })

17. Tests:
    - Web smoke: details form → submit → Payment Element renders
    - Stripe.js mocked at module boundary (don't load real Stripe.js in tests)
    - Confirmation page polls and reflects state changes

== Env ==

18. .env.example additions:
    STRIPE_PUBLISHABLE_KEY=pk_test_replaceme
    STRIPE_TWIN_PUBLISHABLE_KEY=pk_twin_anything
    (existing STRIPE_* vars from chunk 10 stay)

19. README: add "Public booking flow" subsection under "Public booking pages in dev" explaining how to drive submit-to-paid in dev (use ?auto=1 on the Stripe twin checkout return).

CONSTRAINTS (constitution)
- No file over 400 LOC.
- TS strict.
- No mention of Claude/Anthropic/OpenAI/Copilot anywhere.
- Light mode default.
- All external service calls via adapters.
- Customer PII (name, phone, email, full address) NEVER logged. Extend pino redact list.
- Stripe webhook signature verified FIRST. Always.
- Idempotency at every webhook handler — replay is normal, not an error.
- Money in cents everywhere.

DONE WHEN
- Owner can complete Stripe Connect onboarding via /settings/payments → twin auto-completes → status flips to active
- Public booking form submits end-to-end with twin Stripe: form → geocode → payment intent → Payment Element → twin auto-completes → confirmation page shows "Booked!" → Appointment row exists with correct snapshot
- Slot race: two simultaneous submits for the same slot → one succeeds, one gets 409
- Bad address (ZERO_RESULTS): 400 with actionable message, no BookingPageRequest
- $0 deposit service: 409 (booking page not for free services in v1)
- Connect chargesEnabled=false on tenant: booking page disables submit (chunk 11's past_due-style render kicks in)
- Webhook replay: appointment created exactly once
- Email confirmation goes to stdout (visible in api logs)
- All chunk-11 tests still pass; chunk-9 drag still works; chunk-10 webhook dedupe still works
- pnpm typecheck ✅, pnpm lint ✅, pnpm test ✅
- pnpm preflight && pnpm dev still up; full submit flow works in browser at slug.localhost:5173

OUT OF SCOPE
- SMS confirmation (chunk 14)
- Real SES email (chunk 22)
- "Manage booking" UI for the customer (chunk 17 — reschedule via signed link)
- Application fee for platform (v2 monetization)
- Multi-currency
- Refund UI on the customer side (owner can refund from chunk 16+ appointment detail; customer self-refund is v2)
- Tax / Stripe Tax integration
- Saved payment methods (no customer accounts per product spec)
- 3D Secure UX polish beyond what Stripe Payment Element gives for free
- Apple Pay / Google Pay buttons (Payment Element supports them out of the box if configured; defer the configuration to v2)

WHEN DONE
Recap in <18 lines:
- Files added per area (twin extensions, adapter live impls, schema, api routes, web)
- Connect onboarding flow: did the lazy-create + status sync approach feel clean, or did you need to bake into signup
- Slot re-validation at submit: how often did test cases catch a real conflict vs the depot-coord stand-in being right by accident
- Idempotency key strategy on payment intent — confirm a retried submit produces one intent
- Match-or-create Client logic: how you handled phone normalization (E.164? bare digits? both?)
- BookingPageRequest expiry: inline lazy check vs scheduled job — which you picked
- Any chunk-2 schema gap discovered when wiring BookingPageRequest fully
- Any spec ambiguity for chunk 13 (tier upgrade/downgrade) — esp. proration UX copy and what happens to active recurring appointments on downgrade

Hold for eval. Don't start chunk 13. Don't do unsolicited cleanup past the recap.
```

---

## After chunk 12

Replace this file with the chunk 13 prompt. Chunk 13 builds the tier upgrade/downgrade flow + Stripe Customer Portal session. Spec ambiguities to lock before writing:

- Proration UX copy (Stripe computes proration; we display)
- Downgrade behavior on active recurring appointments and the public booking page
- Customer Portal vs custom UI for plan management
- Grace period on downgrade for already-scheduled Pro+ features
