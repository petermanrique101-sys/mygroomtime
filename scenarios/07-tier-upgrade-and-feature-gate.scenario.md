# Scenario: Starter user hits a Pro-gated feature, upgrades, completes the action

**Persona:** Maria on Starter ($49). Three months in, business is growing. Wants to try the public booking page (Pro feature).

**Context:** She's currently on Starter. Pro is $99/mo. Pro-only features: route optimization, recurring appointments, online booking page, Google Calendar sync.

## Steps

1. Maria taps a menu item "Booking Page" in the app sidebar.
2. The page renders with a soft paywall: greyed-out preview of her booking page, plus a card: "Booking pages are a Pro feature. Upgrade to $99/mo to publish yours."
3. She taps "Upgrade to Pro."
4. Modal: "You'll be charged the prorated difference today ($X.XX based on $Y days remaining in your billing period), then $99/mo on [next billing date]. Continue?"
5. She confirms. Stripe updates the subscription. The API receives the `customer.subscription.updated` webhook, updates `Tenant.plan` to `pro`.
6. The page she was on (Booking Page) reloads automatically (or via an in-app push) and the paywall is replaced with the actual editor.
7. She configures her page (banner photo, custom welcome text) and publishes.
8. She visits `planopupspa.mygroomtime.com` in a new tab — it loads.
9. Later, she downgrades back to Starter to test what happens.
10. Modal: "Downgrading to Starter will: (a) hide your public booking page, (b) disable Google Calendar sync, (c) cancel future recurring appointments after their next scheduled instance. Existing customer data is preserved. Continue?"
11. She confirms. Subscription updates. The booking page subdomain returns a 404 within 1 minute. Recurring series are marked `paused_at_downgrade`.

## Satisfaction criteria

- Feature gates are enforced on the **server**, not just hidden in the UI. Hitting the booking-page API endpoint on Starter returns 403 with a payload like `{"error":"plan_required","required_plan":"pro","current_plan":"starter"}`.
- The UI uses the same plan info to render paywalls — single source of truth.
- The prorated upgrade amount is computed by Stripe, displayed accurately, and the user is not charged twice.
- The webhook handler is idempotent (subscription.updated firing twice doesn't double-bill or flip the plan flag twice).
- On upgrade success, the user does NOT have to manually reload or re-navigate. The page they were on becomes functional automatically.
- On downgrade, the user sees a clear "what you'll lose" list — not just "Are you sure?"
- Downgrading does NOT delete data. The booking page is *hidden*, not deleted. Recurring series are *paused*, not deleted. Re-upgrading restores everything.
- The downgrade takes effect immediately for Pro-only feature access, but the user is not refunded the unused portion of the month — they keep Pro until the billing period ends, then drop. *(This is a common SaaS pattern; if the spec implies otherwise, the spec wins.)*
- If Stripe declines the upgrade charge, the user stays on Starter and sees an actionable error.
- A user with role=`groomer` (not `owner`) cannot upgrade or downgrade. They see a "Ask your owner to upgrade" message instead of the paywall CTA.
