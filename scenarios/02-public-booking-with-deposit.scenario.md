# Scenario: Anonymous dog owner books online and pays a deposit

**Persona:** Carlos, dog owner in McKinney TX, found Maria's booking page via her Instagram bio link. Has never used MyGroomTime. On his phone, mildly distracted.

**Context:** Maria has set up her booking page at `planopupspa.mygroomtime.com`. Full Groom requires a $20 deposit. There's an existing appointment at 10am tomorrow (Buddy from scenario 01); Maria's available slots for tomorrow are 12pm and 2pm. The 11am slot is *blocked* because the drive from Buddy's address (75024) to Carlos's address (75070) would take 35 minutes.

## Steps

1. Carlos taps the link. Page loads in under 2 seconds on a throttled 4G connection.
2. He sees Maria's business name, a photo (if uploaded), service menu with prices and durations.
3. Taps "Full Groom $95 · 90 min". Sees deposit notice: "$20 deposit required to book."
4. Taps "Pick a date" → picks tomorrow. Sees available slots: 12pm, 2pm. Does NOT see 11am.
5. Picks 12pm.
6. Enters: his name (Carlos Reyes), phone, email, address (4567 Elm St McKinney 75070), pet info (Luna, mini schnauzer, 18 lb, curly coat). No vaccination expiry required at booking.
7. Reviews the booking summary. Taps "Pay $20 deposit & book".
8. Stripe Payment Element loads inline. Enters card. Submits.
9. Sees "Booked!" confirmation page with appointment time, address-on-file, and a "Manage booking" link.
10. Receives SMS: appointment details + manage link + ICS attachment link.
11. Receives email with the same info (because email was provided).
12. Maria, on her phone, sees the new appointment appear on her calendar within 5 seconds (or on next refresh — depending on whether realtime is implemented in this chunk).

## Satisfaction criteria

- 11am slot is correctly excluded because of drive-time math, not just because of overlap with the 10am appointment ending at 11am.
- Carlos's address is **outside** Maria's service area zip list (75070 vs the 75023/24/25 she configured). The booking page should either: (a) reject the address with a clear message and offer a waitlist, OR (b) allow it but show a clear "outside service area — Maria may decline" disclosure. **Whichever choice the spec implies, it must be explicit, not silent.** *(Note: spec did not explicitly cover this. If it fails, fix spec first.)*
- Deposit charge is via Stripe Connect, hitting Maria's connected account, not the platform account.
- If Stripe declines the card, Carlos sees an actionable error ("Card declined — try a different card") and stays on the same page with his form data intact.
- If Carlos abandons mid-payment, no appointment is created. The slot is still available 5 minutes later.
- If Carlos completes payment but the webhook is delayed, the confirmation page still shows "Booked!" (the API treats the payment intent's status as authoritative, doesn't wait for the webhook to confirm).
- SMS and email both go out within 30 seconds of booking. If either fails, the appointment is still booked and the failure surfaces in the operator log, not to Carlos.
- The booking page does NOT require Carlos to create an account.
- The manage link in the SMS works without login — it's a signed token, single-purpose, expires in 30 days.
