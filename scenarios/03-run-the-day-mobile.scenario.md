# Scenario: Groomer runs a 6-appointment day from her phone

**Persona:** Maria (same as scenario 01). It's 7:45am, she's in her van about to start her day.

**Context:** 6 appointments today across Plano. Order in calendar: 8am Buddy, 9:30 Luna, 11:30 Max, 1pm Daisy, 2:30 Cooper, 4pm Bella. Route optimization should reorder these for minimum drive time. App is on her phone, screen lock disabled during work hours.

## Steps

1. Maria opens the app. Lands on today's route view (not generic calendar).
2. Sees the optimal order — which may NOT match the chronological calendar order. Each stop shows: pet name + owner name, service, address, ETA, drive time from previous stop.
3. The first stop (let's say it's Buddy at 8am — closest to her home base) is highlighted as "Next."
4. She taps Buddy's card → "On the way." A 2h-ETA SMS fires to Buddy's owner with a live tracking link.
5. She drives, arrives, taps "Started." Timer starts.
6. Finishes 75 min later, taps "Complete." Prompt: "Tip suggestion 18% / 20% / 22% / custom / skip." Stripe captures the balance + tip.
7. Prompt: "Rebook in 4 / 6 / 8 weeks?" with 6 weeks pre-selected (because previous interval). She confirms 6 weeks.
8. SMS to owner: receipt + review request link.
9. Next stop highlights automatically. She taps "On the way." Continues.
10. Mid-day, she gets a call: Cooper's owner wants to cancel. She opens the appointment, taps "Cancel" → confirm dialog ("Refund the $20 deposit? Yes / No").
11. After cancel, route recomputes — the gap means Daisy and Bella may now reorder.

## Satisfaction criteria

- Route view is the default landing screen during business hours, not the calendar.
- The "optimal order" is actually optimal (or at least better than naive chronological — the spec is OK with "first-feasible heuristic" but it must beat doing nothing).
- "Drive time from previous stop" uses Google Maps Distance Matrix; in dev/test it uses the [[twin-google-maps]] which returns deterministic times.
- "On the way" → SMS within 10 seconds. The tracking link works (live ETA, even if simplistic — a static "ETA: 9:15am" page is acceptable v1).
- The Stripe balance capture is the *configured service price minus deposit already paid*, plus tip. If the deposit was $0, it's the full price.
- The tip prompt does NOT default to a non-zero value — the customer didn't ask for AI grooming and they didn't ask to auto-tip. Each option is explicit, "skip" is one tap.
- "Rebook in N weeks" creates a `RecurringSeries` AND a concrete appointment on that future date AND schedules the 1-week-prior SMS.
- Canceling triggers a refund confirm dialog with the **specific dollar amount** stated. Not "Refund deposit?" — "Refund $20.00?"
- After cancel, the route recomputes within 10 seconds. The user sees the new order without manually refreshing.
- The whole day's flow works on 375x812. Tap targets ≥ 44px. No tooltips that require hover.
- Battery drain: the app does not poll the server faster than once per 30 seconds when idle. (Verify with devtools network tab.)
