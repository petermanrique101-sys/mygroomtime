# Scenario: Recurring series fires the 1-week-prior SMS and rebooks correctly

**Persona:** System (no human in the loop for most of it), with a dog owner replying to an SMS.

**Context:** 6 weeks ago, Maria completed a Full Groom for Buddy and selected "Rebook in 6 weeks." A `RecurringSeries` exists with interval=6 weeks, next_due=today+0 (it's been materialized into a concrete appointment 14 days ago by the `recurring-rebook` job). It's now 7 days before that concrete appointment.

## Steps

1. The `sms-outbound` job, scheduled at the time the appointment was materialized, fires at 9am — 7 days before the appointment.
2. Buddy's owner Jane receives SMS: "Hi Jane — Buddy's next groom with Plano Pup Spa is on [date] at [time]. Reply C to confirm, R to reschedule, or call (214) 555-0100 to cancel."
3. Jane replies "R" by text.
4. Twilio inbound webhook arrives at the API. The `SmsMessage` row is created with direction=in, body="R".
5. The system matches "R" to the most recent outbound SMS to that phone number, finds the appointment, generates a signed reschedule link, and replies via SMS: "No problem — pick a new time here: [link]"
6. Jane taps the link, sees an availability page (same UX as the public booking page but pre-filled with Buddy's info and the existing deposit credited).
7. She picks a new slot 3 days later. Confirms.
8. The original appointment is canceled (status=canceled, reason=client_reschedule), the new appointment is created with the existing deposit applied. The `RecurringSeries.next_due` is updated to 6 weeks from the new date.
9. Maria's calendar reflects the move within 1 minute. She gets an in-app notification: "Buddy rescheduled from [old] to [new]."

## Satisfaction criteria

- The 1-week-prior SMS fires at 9am in **Maria's** business timezone (not UTC, not Jane's timezone). Configurable per tenant later, but defaulting to business timezone is correct.
- "C" and "R" replies are matched case-insensitively and trimmed.
- The reschedule link is single-use and expires when the appointment passes. After use, the same link shows "This link has been used — your appointment is on [new date]."
- The deposit is **not** re-charged on reschedule. The existing payment is credited.
- The `RecurringSeries.next_due` updates from the **new** date, not the original — so a 3-day push doesn't compound over time.
- If Jane replies with anything other than "C" or "R" (e.g. "STOP"), it's handled: STOP sets `Client.sms_opt_out=true` and stops future SMS to that number. Other replies trigger a fallback SMS: "Sorry — I didn't catch that. Reply C to confirm, R to reschedule, or call us."
- Twilio webhook is verified (signature check). Replayed webhooks are deduplicated by Twilio MessageSid.
- The job that fires the 1-week SMS is idempotent — running it twice does not send two SMS.
- If the appointment was canceled or already rescheduled between job-scheduling and job-firing, the job no-ops gracefully.
