# Scenario: Appointment is a no-show, deposit policy is enforced, owner opts out

**Persona:** Maria, mid-morning. Plus dog owner Sarah, who didn't show.

**Context:** Sarah booked a Full Groom 4 days ago through the public page. $20 deposit captured. Appointment time was 9:00am. It's now 9:25am, Maria is at Sarah's address, no one is answering. Sarah has not replied to the SMS that Maria sent via the in-app "Text customer" button.

## Steps

1. Maria opens the appointment on her phone. Taps "Mark no-show."
2. Confirm dialog: "Mark Sarah Williams' appointment as no-show? The $20 deposit will be retained per your no-show policy. Continue?"
3. She confirms.
4. Appointment status → `no_show`. Deposit is retained (no refund). The 30-minute drive credit is freed in route math.
5. Maria's daily stats update: no-show count +1.
6. SMS fires to Sarah: "Hi Sarah — we missed you at 9am today. Your $20 deposit was retained per the booking terms. Reply RESCHEDULE to book a new time, or call (214) 555-0100. Reply STOP to opt out of messages."
7. Sarah replies "STOP."
8. Twilio inbound webhook fires. `Client.sms_opt_out=true`. Twilio's built-in STOP handling also unsubscribes at the carrier level.
9. The system does NOT send a "you've been unsubscribed" SMS (Twilio handles that automatically; doubling up would look broken).
10. 2 weeks later, Sarah's friend (different number) tries to book on Maria's page using Sarah's address. The booking is allowed — the opt-out is per phone number, not per address.
11. Maria sees Sarah's name on the "No-shows last 30 days" dashboard widget. She can tap to manually issue a courtesy refund if she changes her mind ("Refund $20.00 to Sarah Williams? Yes / No").

## Satisfaction criteria

- "Mark no-show" requires explicit confirmation with the dollar amount stated.
- Deposit policy is not auto-refunded on no-show. The owner's tenant settings drive this; default = retain.
- The no-show SMS includes "Reply STOP" wording so Twilio's auto-unsubscribe trips correctly.
- STOP reply sets `Client.sms_opt_out=true` and the system does NOT send any further SMS to that number, including reminders for *other* future appointments under the same phone.
- If the same number tries to book again on the public page, they're told politely: "Looks like this number has opted out of SMS. You can still book if you'd like, but you won't receive reminders. Continue? Yes / No."
- Manual refund from the dashboard hits Stripe, returns a refund object, updates the appointment, and logs who triggered it.
- The dashboard widget "No-shows last 30 days" is accurate (not all-time, not last 7 days).
- Webhook handling: a duplicate Twilio STOP webhook for the same MessageSid does not flip opt-out twice or trigger any side-effect twice.
- Audit: every status transition on an appointment (scheduled → no_show, no_show → refunded) is logged with timestamp, user, and reason. Surfaced in an "Activity" tab on the appointment.
