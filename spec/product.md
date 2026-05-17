# Product — MyGroomTime

## Summary

MyGroomTime is a scheduling and client-management SaaS for solo and small-team mobile dog groomers. The groomer drives a van between appointments; the app lives on their phone. It owns the calendar, the client/pet records, the public booking page, SMS reminders, route order between stops, and money in via Stripe.

The product replaces the spreadsheet + Google Calendar + manual SMS + Venmo stack that most mobile groomers limp along with today.

## Primary user

**Solo or small-team mobile groomer.** Owns 1-5 vans. Works from the phone all day. Their pain is no-shows, drive-time math, taking deposits, and rebooking the regulars. They are not technical and they have one hand on a clipper most of the day.

Secondary user: **Dog owner** booking on the public page. Visits once, books, gets SMS reminders, pays. Doesn't have an account.

## Core user flows

### 1. Owner signs up and onboards
1. Owner visits mygroomtime.com, picks a tier (Starter / Pro / Business)
2. Stripe Checkout for the monthly subscription
3. After payment, lands on onboarding: business name → subdomain (slug.mygroomtime.com) → service menu (default templates: Full Groom, Bath & Brush, Nail Trim, with editable prices) → hours and service area (zip codes) → Stripe Connect onboarding for taking customer payments
4. Lands on empty calendar with a "Add your first client" CTA

### 2. Owner adds a client and books an appointment
1. From calendar, taps "+" → "New client"
2. Enters owner name, phone, address, then "Add pet" → name, breed, weight, coat type, temperament notes, vaccination expiry (optional), photo (optional)
3. Saves → returns to calendar
4. Taps a time slot → picks client → picks service → confirms
5. SMS confirmation goes to the dog owner with appointment time, address-on-file, deposit link (if deposit required for this service)

### 3. Owner runs the day
1. Morning: opens app, sees today's route in optimal order (computed overnight). Each stop shows pet name, service, address, ETA, drive time from previous stop
2. Taps first appointment → marks "On the way" → 2h ETA SMS fires to the dog owner with a live ETA link
3. Arrives → marks "Started"
4. Finishes → marks "Complete" → balance charge fires automatically (Stripe captures the remainder beyond the deposit + a configurable default tip prompt)
5. SMS goes to owner with receipt + review-request link
6. Next stop on the route highlights

### 4. Recurring rebook
1. When marking an appointment complete, app prompts: "Rebook in 4 / 6 / 8 weeks?" with the client's previous interval pre-selected
2. Confirming creates a recurring series; SMS confirmation goes out 1 week before each recurrence
3. Dog owner can reply STOP to opt out of reminders or RESCHEDULE to get a link to pick a new time

### 5. Dog owner books online
1. Visits `slug.mygroomtime.com`
2. Picks pet size + service → sees price + duration + deposit
3. Picks a date → sees real-time available slots (filtered by service area, drive time math, existing appointments)
4. Enters owner + pet info, address
5. Stripe payment for the deposit
6. Gets SMS confirmation + ICS file + a link to manage/cancel the booking

### 6. Owner reviews money + performance
1. Dashboard shows: today's route, revenue (day/week/month), no-show rate (last 30d), top 5 clients by revenue, "gaps to fill" (open windows in the next 7 days where a regular hasn't rebooked)
2. Tapping a metric drills into the underlying list

### 7. Business tier: dispatch across vehicles
1. Owner sees a multi-column day view (one column per van/groomer)
2. Can drag an appointment between vans
3. Route recomputes per van on drag
4. Payroll splits report at end of pay period: per-groomer revenue, per-groomer tip total

## Data model (prose)

**Tenant** — one per paying business. Has plan tier, billing customer, subdomain slug, default service area, Stripe Connect account id.

**User** — belongs to one tenant. Roles: `owner`, `groomer`, `dispatcher`. Auth via email + password (magic link as alt) and a session cookie. Owners can invite groomers (Pro/Business).

**Vehicle** — belongs to a tenant. Has a name and an assigned groomer (nullable). Starter has implicit single vehicle; Pro up to 3; Business unlimited.

**Service** — belongs to a tenant. Name, duration (minutes), base price, deposit amount (or 0), color (for calendar), active flag.

**Client** (the dog owner) — belongs to a tenant. Name, phone, email (optional), address (street, city, zip, geocoded lat/lng), preferred groomer (optional), notes, created date.

**Pet** — belongs to a Client. Name, breed, weight (lb), coat type (enum: short/medium/long/curly/double/wire), temperament notes (free text), preferred cut style (free text), vaccination expiry (date, optional), photo URL (optional), last cut date (derived from latest completed appointment).

**Appointment** — belongs to a tenant, references a Pet, a Service, a Vehicle, a Groomer (user). Has scheduled start time, duration, status (`scheduled`/`on_the_way`/`started`/`completed`/`canceled`/`no_show`), deposit charge id, balance charge id, tip amount, final notes. Has optional `recurring_series_id`.

**RecurringSeries** — belongs to a tenant, references a Pet and a Service. Interval in weeks, next due date, active flag.

**BookingPageRequest** — public submissions from the booking page before they become Appointments. Pending until the deposit charge succeeds.

**SmsMessage** — outbound log. Tenant, client, appointment, direction (out/in), body, status, twilio sid. Inbound STOP/RESCHEDULE replies update the client's opt-out flag or trigger a rebook link.

**WebhookEvent** — raw Stripe/Twilio webhook payloads, dedup'd by event id, with processing status. Replay-safe.

## Out of scope (v1)

Explicitly **not** building these. They go in `v2.md` if requested.

- Native mobile apps (Android/iOS). v1 is a mobile-web PWA.
- Inventory tracking (shampoo, blades, etc).
- Employee time clock / hours tracking.
- Customer-facing "my appointments" account with login. Dog owner manages via SMS links + magic link only.
- Multi-language. English only v1.
- Multi-currency. USD only v1.
- Loyalty / referral programs.
- Photo gallery / before-after marketing site.
- Integrations beyond the four listed (Stripe, Twilio, Google Calendar, Google Maps).
- Quickbooks / accounting export. CSV export is enough for v1.
- Marketing emails / drip campaigns.
- AI-anything (no AI cut recommendations, no AI scheduling).
- Tenant-level theming / white-label.
- A separate desktop dashboard. Desktop is responsive-bonus; phone is primary.
