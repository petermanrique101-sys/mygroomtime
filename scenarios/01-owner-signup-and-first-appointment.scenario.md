# Scenario: Owner signs up, onboards, and books a first appointment

**Persona:** Maria, solo mobile dog groomer in Plano TX, currently using a paper calendar and Venmo. Heard about MyGroomTime from a Facebook group. On her phone in a parked van between appointments.

**Context:** Has never used the product. Has a Stripe account from a previous side business. Wants to try Starter tier and see if it replaces her spreadsheet.

## Steps

1. On her phone, Maria visits `mygroomtime.com`.
2. Taps "Start free trial" → picks Starter ($49/mo) → enters card → completes Stripe Checkout.
3. Lands on onboarding step 1: business name → enters "Plano Pup Spa". Picks subdomain "planopupspa". The slug-available check happens live as she types.
4. Step 2: service menu. Default templates are pre-filled (Full Groom $85, Bath & Brush $50, Nail Trim $20). She bumps Full Groom to $95 and disables Nail Trim.
5. Step 3: hours. Mon–Sat 8am–5pm. Service area: enters zip codes 75023, 75024, 75025.
6. Step 4: Stripe Connect onboarding. Redirects to Stripe, she completes it, returns.
7. Lands on empty calendar (today's date, week view). Sees "Add your first client" CTA.
8. Taps "+" → "New client" → fills in: Jane Doe, (214) 555-0142, 1234 Oak St Plano 75024 → "Add pet" → Buddy, Golden Retriever, 65 lb, long coat, "anxious during nail trims", vaccination expiry 2026-11-01.
9. Saves. Returns to calendar.
10. Taps tomorrow 10:00am slot → picks Buddy → picks "Full Groom $95" → confirms.
11. Sees the appointment on the calendar in the service's color. SMS confirmation triggers to Jane's phone.

## Satisfaction criteria

- Onboarding takes ≤ 4 minutes for a non-technical user. No step has unexplained jargon.
- Subdomain availability check is live (no full-form submit to discover it's taken).
- Default service menu is pre-filled so the user only has to *edit*, not *create from scratch*.
- Stripe Connect detour returns the user to onboarding step 5 with their progress intact, not the beginning.
- The "Add your first client" CTA is visually obvious on an empty calendar (not just a faded placeholder).
- After saving the client, the user lands back on the calendar with the appointment-creation flow accessible in ≤ 2 taps.
- The booked appointment appears on the calendar **immediately** (optimistic update, then confirm), not after a page reload.
- The SMS to Jane includes: business name, appointment time in Jane's local timezone, address-on-file, no deposit link (because Maria didn't enable deposits for Full Groom in onboarding).
- If Maria force-quits the app and reopens, all state (client, pet, appointment) is persisted.
- On the 375x812 viewport, no horizontal scroll, no overlapping inputs, tap targets ≥ 44px.
