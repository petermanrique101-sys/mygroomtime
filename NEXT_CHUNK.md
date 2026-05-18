# Next chunk — paste-ready prompt

This file holds the **next chunk prompt**, written by the project lead and ready to paste into a fresh agent session.

When this chunk is done and evaluated:
1. Move the prompt below into `CHUNK_LOG.md` history (as a recap entry, not the full prompt).
2. Replace this file's contents with the **next** next chunk prompt.
3. Commit.

---

## Chunk 13 — Tier upgrade/downgrade + Stripe Customer Portal

**Route this to `/senior-engineer`.** Touches money — proration + Customer Portal + plan-state machine. Chunk-10's webhook dedupe + plan-state policy is load-bearing; honor it.

**Before pasting:** verify chunk 12 is committed (`8a6fe0b chunk 12: Stripe Connect onboarding + public booking submit`) and your working tree is clean.

```
/senior-engineer

Implement chunk 13 of MyGroomTime — tier upgrade/downgrade with proration preview + Stripe Customer Portal.

CONTEXT
- Chunks 1-12 landed and committed. CHUNK_LOG.md at repo root has the full history + cross-chunk policy decisions you must honor.
- READ THESE FILES, IN THIS ORDER:
    CHUNK_LOG.md
    spec/constitution.md
    spec/architecture.md
    spec/product.md        (tier pricing/capabilities; tier change UX flow)
    spec/plan.md           (chunk 13 only)
    twins/stripe.md        ← EXCEPTION: allowed (extending the chunk 10 / chunk 12 twin)
- DO NOT READ:
    scenarios/
    twins/twilio.md, twins/google-calendar.md, twins/geocode.md, twins/google-maps.md
- Existing patterns to mirror:
    - chunk 10's Stripe twin + adapter + webhook handling (subscription methods, checkout session)
    - chunk 10's plan-state machine (`requirePaidPlan`, the past_due → write-restricted transition, webhook cascade)
    - chunk 12's adapter test pattern (live + twin integration tests)
    - chunk 10's webhook dedupe (UNIQUE(source,eventId), idempotent handler — replay is normal, not an error)

POLICY DECISIONS (locked — don't ask, see CHUNK_LOG.md for the why)
- Downgrade from `pro` to `starter` does NOT touch existing data. Lock these as comments in the plan-state code:
    - Existing appointments (including any future-dated ones) stay. The grooming was paid for; canceling them would harm customers, not the platform.
    - Existing recurring series (chunk 17 will add them; for now they don't exist) keep firing until they end naturally. Block creation of NEW recurring series once `plan='starter'`.
    - Pending `BookingPageRequest` rows expire normally via existing 30-min TTL — no special refund flow. New submits to the public booking page get 404 from chunk-11's tier gate.
    - Public booking page: chunk 11 already 404s on `starter`. Verify the transition (a tenant downgrades while a customer is mid-booking-flow — that customer gets 404 on submit, deposit is never charged because the form errors out before payment intent creation).
- Proration: show the dollar amount BEFORE the customer confirms. Server fetches Stripe's `upcoming invoice` preview, web renders "Today: $X (credit or charge), then: $Y/mo on <date>." Two round-trips (preview, then confirm) is the right trade — the dollar amount is what every "is this worth it" question is actually about. `proration_behavior: 'create_prorations'`.
- Tier change is initiated by `POST /settings/billing/change-plan` but the plan flip is canonicalized by the `customer.subscription.updated` webhook. The route returns success after Stripe accepts; the webhook moves `Tenant.plan` to the new value once Stripe confirms.
- Block plan changes when `Tenant.plan` is `past_due` or `canceled`. They must resolve billing first (existing chunk 10 flows).
- No-op plan changes (starter → starter): reject with 400, don't roundtrip Stripe.
- Customer Portal session is a separate concern from change-plan: portal handles card updates, invoice history, cancel-at-period-end. Use it for "Update card" and "Cancel subscription"; use change-plan for tier moves. (Portal can also do tier changes, but we want the proration preview UX, so we own that flow.)

SCOPE — chunk 13
End-to-end tier upgrade/downgrade with proration preview + Customer Portal session.
- Server: preview route, change-plan route, portal-session route, webhook handles tier flip.
- Web: /settings/billing page shows current plan + tier matrix + "Change plan" action with two-step preview/confirm modal + Customer Portal button.
- Twin: extend to support upcoming-invoice preview + subscription tier change + billing portal session.

Deliverables

== Stripe twin extension ==

1. Extend twins/stripe with:
   - POST /v1/billing_portal/sessions — already added in chunk 10; verify it returns a working URL that 200s on GET (the URL can be a no-op page hosted by the twin that 302s back to the configured return_url after a short delay or query-param trigger ?return=1). If not implemented, add it.
   - POST /v1/invoices/upcoming (POST per the new Stripe API; older code may call retrieveUpcoming — accept the older GET form too if needed for the adapter). Body: { customer, subscription, subscription_items: [{ id, price }], subscription_proration_behavior }. Returns: { amount_due, lines: [...proration line items with amount + description], next_payment_attempt }. Compute proration with a simple linear formula: credit = currentTierPrice * (timeRemainingInPeriod / periodLength); charge = newTierPrice * (timeRemainingInPeriod / periodLength); amount_due = max(0, charge - credit). For prorated *credits* on downgrade (amount_due < 0), Stripe wires this as a credit balance applied to the next invoice — model that too, return amount_due=0 with a "balance applied" line item for downgrades.
   - POST /v1/subscriptions/:id — extend to support `items[]` with `{ id, price }` updates and `proration_behavior` flag. When called, update the in-memory subscription's priceId, fire `customer.subscription.updated` with the new price.id in items[0].price.

2. Add twin tests for the above endpoints (twins/stripe is allowed to expand here per the read-list exception).

== Stripe adapter (live + twin implementations) ==

3. apps/api/src/adapters/stripe/types.ts — add:
    type PlanPreview = {
      amountDueCents: number;        // 0 if it's a credit
      creditCents: number;            // >0 if downgrade; 0 otherwise
      chargeCents: number;            // >0 if upgrade; 0 otherwise
      currentPeriodEndIso: string;    // for "then $Y/mo on <date>" copy
      nextChargeCents: number;        // the new monthly amount
    };

    interface StripeAdapter {
      ...existing methods...
      previewPlanChange(input: { customerId, subscriptionId, newPriceId }): Promise<PlanPreview>;
      changePlan(input: { subscriptionId, newPriceId, idempotencyKey }): Promise<void>;
      createPortalSession(input: { customerId, returnUrl }): Promise<{ url: string }>;
    }

4. apps/api/src/adapters/stripe/live.ts — implement the three methods against the real Stripe SDK.
5. apps/api/src/adapters/stripe/twin.ts — implement against the twin's new endpoints.
6. Adapter integration tests in apps/api/src/adapters/stripe/integration.test.ts:
    - Preview returns the expected proration shape for an upgrade and a downgrade
    - changePlan succeeds against the twin and fires `customer.subscription.updated`
    - createPortalSession returns a 200-able URL
    - Idempotency: same changePlan call twice produces one update (idempotency key wired through)

== Schema additions ==

7. Migration: 20260518000000_tenant_subscription_item_and_plan_history
   - Tenant: stripeSubscriptionItemId String?  ← needed because subscriptions.update wants item.id, not just price; populate on signup (chunk 10) and on first plan change here if missing
   - Tenant: lastPlanChangeAt DateTime?
   - Optional new table: TenantPlanChange (id, tenantId, fromPlan, toPlan, prorationAmountCents, createdAt) — useful for the audit log when chunk 22 builds the operator log; skip if you'd rather defer.
   - Add a one-time backfill in the migration to populate stripeSubscriptionItemId for any existing Pro/Starter/Business tenants (small enough table — fetch each subscription via the live adapter, populate, log misses). For dev/test, the seed flow will set this naturally.

== API routes ==

8. apps/api/src/routes/settings/billing.ts (or extend the existing settings/payments.ts if cohesive — chunk 12 added settings/payments.ts for Connect; billing/portal could live there or split; you decide based on file size).

   GET /settings/billing
   - Returns { plan, currentPeriodEnd, hasPaymentMethod, available: [{ tier: 'starter', priceMonthly: 49 }, ...] }
   - Reads from Tenant + an inexpensive Stripe customer fetch (or cached from chunk 10 — verify what's available).

   POST /settings/billing/preview-plan-change
   - Body: { targetPlan: 'starter' | 'pro' | 'business' }
   - Validates: tenant.plan is `starter`/`pro`/`business` (not past_due/canceled/unpaid)
   - Validates: targetPlan != tenant.plan (no-op rejected with 400)
   - Calls adapter.previewPlanChange
   - Returns: PlanPreview shape

   POST /settings/billing/change-plan
   - Body: { targetPlan, confirmedPreviewToken? } — see note below
   - Same validation as preview
   - Calls adapter.changePlan with idempotency key = `tenantId:${ts-bucketed-to-5min}` so accidental double-click is one Stripe call
   - Returns 202 with { pending: true, willTakeEffect: 'webhook' }; the Tenant.plan flip happens on the next customer.subscription.updated webhook
   - "confirmedPreviewToken": Optional. If you want extra protection against the preview being stale (Stripe's proration is time-sensitive), have preview return an opaque HMAC of (tenantId, targetPlan, previewAmountCents, ts) and require it on confirm with a 5-min TTL. RECOMMENDED v1: skip this — the preview-to-confirm gap is at most a few seconds in normal UX, and Stripe's proration is monotonic over short windows. Add the token only if user testing reveals flakes.

   POST /settings/billing/portal-session
   - Calls adapter.createPortalSession with returnUrl = `${webOrigin}/settings/billing`
   - Returns { url }

9. apps/api/src/routes/webhooks/stripe/handlers/subscription-updated.ts (already exists from chunk 10 for past_due/active flips) — EXTEND to handle tier changes:
   - Parse items[0].price.id from the event
   - Map price id → plan tier via env (priceIdStarter/Pro/Business)
   - If tenant.plan != mappedPlan: update Tenant.plan + lastPlanChangeAt + stripeSubscriptionItemId from items[0].id
   - Insert TenantPlanChange row (if you went with the table option in step 7)
   - Idempotent: already replay-safe via chunk-10 UNIQUE(source,eventId)

== Web ==

10. apps/web/src/routes/settings/billing.tsx
    - Card: "Current plan: Pro — $99/mo. Next charge: $99 on May 31."
    - Tier matrix: 3 cards (Starter / Pro / Business) with capabilities + price; current tier marked "Current," others have "Switch to <tier>" button.
    - Click "Switch to <tier>" → fetch POST /settings/billing/preview-plan-change → open modal:
      - Modal title: "Switch to <Tier> — $X/mo"
      - Body: "Today: $X (charge OR credit on next invoice). Then: $Y/mo starting on <date>."
      - Bulleted "What changes" list (mirrors the tier capabilities — if downgrade from pro to starter, explicitly: "Public booking page will no longer be available to your customers")
      - Buttons: "Cancel" / "Confirm switch to <Tier>"
    - Click "Confirm" → POST /settings/billing/change-plan → on success, show toast "Plan change in progress — your account will update in a moment." → poll GET /settings/billing every 2s for 30s and refresh the card when plan changes.
    - "Update card / Manage subscription" button → POST /settings/billing/portal-session → window.location.href = url
    - On return from portal (the page loads again), refresh state via GET /settings/billing.

11. apps/web/src/lib/settings-billing-api.ts — typed fetch wrappers for the four routes.

12. Tests:
    - Web smoke: tier matrix renders; click switch → preview modal shows; confirm submits.
    - Server: preview happy path, no-op rejected, past_due blocked, change-plan returns 202.
    - Webhook tier flip updates Tenant.plan correctly.

== Env / docs ==

13. .env.example is already populated from chunk 10 with priceIdStarter/Pro/Business. No new env in chunk 13.

14. README: add a "Plan changes in dev" subsection under the existing billing section — explain that the twin auto-completes plan changes and the webhook fires immediately.

CONSTRAINTS (constitution)
- No file over 400 LOC. (Pre-existing 405-LOC calendar.test.tsx is in chunk 9; leave it alone unless you touch it.)
- TS strict.
- No mention of Claude/Anthropic/OpenAI/Copilot anywhere.
- Light mode default.
- All external service calls via adapters.
- Money in cents everywhere. Display formatting in money.tsx.
- Stripe webhook signature verified FIRST.
- Idempotency at every webhook handler — replay is normal.
- Customer-facing copy: no jargon. "Prorated credit" is fine if it's labeled clearly. "We'll credit $12.34 to your next invoice" beats "$12.34 proration applied."

DONE WHEN
- Owner on Pro can preview a switch to Starter, see the credit amount, confirm, and the Tenant.plan flips to Starter via the webhook within a few seconds (twin auto-fires)
- Owner on Starter can preview a switch to Pro/Business, see the charge amount, confirm, plan flips correctly
- Same plan → same plan rejected with 400
- Past_due tenant blocked from plan changes with a clear error
- Stripe Customer Portal opens (twin returns a redirectable URL; live returns the real Stripe portal URL)
- Webhook replay of customer.subscription.updated produces exactly one plan flip
- All chunk-1-through-12 tests still pass
- pnpm typecheck ✅, pnpm lint ✅, pnpm test ✅
- pnpm preflight && pnpm dev still up; full plan-change flow works in browser

OUT OF SCOPE
- Pause subscription (not in product spec)
- Annual billing / different billing cadences (v2)
- Multi-currency
- Coupons / promo codes
- Plan-tier-specific feature flags inside the app (those are enforced by middleware per existing chunk 10/11 patterns, not added here)
- Recurring appointments themselves (chunk 17; the chunk-13 policy is "block creation" but there's no creation code yet to gate)
- Refund flow for the deposit on a customer-side BookingPageRequest mid-downgrade (deferred — pending rows expire naturally; tenant downgrade doesn't trigger any refund)
- Operator log entries for plan changes (chunk 22 will surface TenantPlanChange if you added the table)
- "Cancel subscription" UI in-app — defer to the Customer Portal (cancel goes through portal in v1)

WHEN DONE
Recap in <18 lines:
- Files added per area (twin extensions, adapter changes, schema migration + backfill notes, api routes, web)
- Did you split billing routes from the chunk-12 payments.ts or keep them together — and why
- Proration preview shape: what fields actually landed in PlanPreview after seeing what the real upcoming-invoice gives back (the spec is approximate; report actual)
- Idempotency key choice on change-plan and any flakes you saw under double-click testing
- Backfill of stripeSubscriptionItemId: did you actually need to backfill, or is it always populated at signup once you wired chunk-10 properly
- Downgrade UX copy you ended up with (the "what changes" bullets) — verbatim, so the user can review
- Plan-state machine touchpoints you noticed (requirePaidPlan, the read-only past_due handling) — anything that needed adjustment as part of the tier-flip work
- TenantPlanChange table: did you add it (chunk 22 use) or skip it
- Any spec ambiguity for chunk 14 (Twilio twin + outbound SMS) you noticed while reading

Hold for eval. Don't start chunk 14. Don't do unsolicited cleanup past the recap.
```

---

## After chunk 13

Replace this file with the chunk 14 prompt. Chunk 14 builds the Twilio twin + SMS adapter + 48h/2h/post-appointment scheduled jobs. Spec ambiguities to lock before writing:

- Whether reminders fire on appointments that exist at the time the rule is added, or only on new ones
- Opt-out copy + when "STOP" responses surface back to the groomer (live in client detail? toast?)
- What happens to the scheduled SMS if the appointment is rescheduled or canceled between schedule time and fire time
