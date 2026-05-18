# Next chunk — STUB (chunk 13)

**Not paste-ready.** Two policy questions need to be locked before the full prompt can be written and shipped to a fresh agent session.

---

## Chunk 13 — Tier upgrade/downgrade + Stripe Customer Portal

Adds the upgrade/downgrade flow for the three plan tiers (starter $49 / pro $99 / business $149), plus a Stripe Customer Portal session so the owner can update card / cancel subscription without leaving the app.

### Unresolved policy questions (decide before authoring the prompt)

**1. What happens to active recurring appointments on downgrade from `pro` → `starter`?**
- Pro-only features (public booking, route optimization, recurring, GCal sync) become unavailable. Existing recurring series:
  - (a) **Cancel immediately** — all future occurrences deleted; owner is told upfront in the downgrade modal. Clean but punishing.
  - (b) **Run until series end** — existing series keep firing; no new series can be created. Generous but requires "grandfathered" state tracking.
  - (c) **Run for N days then stop** (grace period) — pick a number. 30 days? 60? Until next billing cycle ends?
- Cross-cuts: public booking page becomes 404 on `starter` (chunk 11 policy). What happens to *pending* `BookingPageRequest` rows when the tenant downgrades mid-booking-flow? Expire them with a refund? Hold for grace period?

**2. When is the prorated credit shown to the customer in the upgrade/downgrade UX?**
- Stripe computes proration on `customer.subscription.update` (`proration_behavior: 'create_prorations'`). Options for the UX:
  - (a) **Show before confirm** — call Stripe `upcoming invoice` endpoint, display "You'll be charged/credited $X today, then $Y/mo," let the customer confirm. Two round-trips, accurate dollar amount.
  - (b) **Show after Stripe responds** — confirm modal shows "$X today, then $Y/mo" with no preview; show the actual charge in a toast after Stripe processes. One round-trip, less friction, no "wait for amount" copy.
  - (c) **No preview, just description** — modal says "you'll be charged for the difference, prorated to the current cycle" without a dollar amount. Cheapest to build, vaguer.

**Recommended starting point** (override as you see fit): 1b — keep existing recurring series running until they end on their own, but block creation of new ones once `plan` flips to `starter`. 2a — show the proration amount before confirm; the round-trip is fast and the dollar amount is what every "is this worth it" question is actually about.

### Things the chunk 13 prompt will need to specify (after the above are resolved)

- Stripe Customer Portal session creation via the live adapter (twin already supports a stub portal URL from chunk 10 — extend if missing).
- Tier change route: `POST /settings/billing/change-plan` → updates the subscription via `stripe.subscriptions.update({ items, proration_behavior })` and returns the upcoming-invoice preview.
- Downgrade modal copy: enumerate what will be lost (must mirror the resolution to question 1).
- Webhook handling for `customer.subscription.updated` when proration credits are applied — already idempotent via chunk-10 dedupe; verify the plan-state machine reacts correctly to mid-cycle tier flips.
- Tests for proration preview, downgrade with active recurring series, public-booking-page 404 transition.

### When the chunk 13 prompt is ready

Replace this file with the paste-ready version (route to `/senior-engineer`, include CONTEXT/POLICY DECISIONS/SCOPE/DELIVERABLES/CONSTRAINTS/DONE-WHEN/OUT-OF-SCOPE/WHEN-DONE sections matching the chunk 12 template that lived here previously — preserved in git history at the chunk-12 commit).
