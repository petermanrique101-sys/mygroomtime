# Next chunk — paste-ready prompt

This file holds the **next chunk prompt**, written by the project lead and ready to paste into a fresh agent session.

When this chunk is done and evaluated:
1. Move the prompt below into `CHUNK_LOG.md` history (as a recap entry, not the full prompt).
2. Replace this file's contents with the **next** next chunk prompt.
3. Commit.

---

## Chunk 16 — Route optimization + day route view

**Route this to `/senior-engineer`.** Pro+ feature — touches the calendar UI + a new "today's route" view + uses the gmaps adapter for ordering. Honor the chunk-11 tier gate (route optimization is Pro+ per spec/product.md).

**Before pasting:** verify chunks 1-15 are committed and your working tree is clean. `pnpm preflight && pnpm dev` should be running.

```
/senior-engineer

Implement chunk 16 of MyGroomTime — route optimization + day route view.

CONTEXT
- Chunks 1-15 landed and committed. CHUNK_LOG.md at repo root has the full history + cross-chunk policy decisions you must honor.
- READ THESE FILES, IN THIS ORDER:
    CHUNK_LOG.md
    spec/constitution.md
    spec/architecture.md
    spec/product.md        (today's route flow; route optimization tier capability)
    spec/plan.md           (chunk 16 only)
    twins/google-maps.md   ← EXCEPTION: allowed (extending the chunk 5 twin if needed)
- DO NOT READ:
    scenarios/
    twins/stripe.md, twins/twilio.md, twins/google-calendar.md, twins/geocode.md
- Existing patterns to mirror:
    - chunk 9's buffer math + drive-time computation (gmaps adapter is already wired; route ordering reuses the same distance-matrix call)
    - chunk 11's tier gate on Pro+ routes (route optimization is Pro+; Starter gets 404 or feature-disabled)
    - chunk 8's day calendar view (the route view is a different presentation of the same day's appointments)

POLICY DECISIONS (locked — don't ask, see CHUNK_LOG.md for the why)
- **Drive-time unit convention: minutes everywhere in API responses.** The gmaps adapter returns seconds (existing contract); convert at the route handler boundary. Internal computation can use seconds, but anything serialized to the client is minutes (rounded). Matches how appointment durations are already represented.
- **No live ETA URL in v1.** The 2h SMS does not include a "track your groomer" link in this chunk. Defer to a later chunk when there's a real GPS source feeding live position. The 2h reminder copy stays as chunk-15 specified.
- **Route optimization is Pro+ only.** Starter tenants don't see the "Optimize route" button. Backend route returns 403 with `reason: 'tier_gated'` if a Starter tenant hits it.
- **The optimizer doesn't mutate `Appointment.scheduledStart` automatically.** Route optimization computes an ordering + suggested time shifts, displays them in the UI, and lets the owner accept (which applies the shifts as actual reschedules) or dismiss. Auto-mutating breaks the chunk-9 drag-to-reschedule UX promise that the owner is in control of their day.
- **Optimization respects existing locked appointments.** If a tenant marks an appointment as "locked" (chunk-9 added the field? if not, scope this chunk to add `Appointment.timeLocked Boolean @default(false)`), the optimizer treats it as a fixed anchor and orders other appointments around it.
- **Vehicle scope**: route optimization is per-vehicle per-day. Multi-vehicle dispatch (chunk 21) extends this for Business tier; chunk 16 ships single-vehicle (the default vehicle, chunk-9 wiring).
- **Depot / start + end coords**: the route starts and ends at `Tenant.depotLat/Lng` (existing from earlier chunks). If unset, route ordering uses the first appointment as the start anchor and shows a warning in the UI suggesting the tenant configure their depot in settings.

SCOPE — chunk 16
End-to-end route optimization + dedicated day route view.
- Server: optimization service + `GET /appointments/today/route` (and a `/route?date=YYYY-MM-DD` form for non-today views).
- Web: a "Today's Route" page (or tab in the calendar) showing the appointments in optimized order with drive-time between stops + map placeholder. "Optimize" button on the day view triggers the suggestion; "Apply" persists the reschedules.
- Twin: extend twins/gmaps to support a `routes:computeRouteMatrix` style endpoint OR keep using distance-matrix for v1. Recommended v1: reuse distance-matrix N×N and compute ordering server-side. Avoids twin work + matches the chunk-9 pattern.

Deliverables

== Optimization service ==

1. `apps/api/src/services/route-optimization.ts`
   - `optimizeRoute(input: { tenantId, vehicleId, date, depotLatLng? })` → `{ orderedStops: Array<{ appointmentId, startSuggested: Date, durationMin, driveFromPrevSec: number, driveFromPrevMin: number }>, totalDriveMin, depotUsed: boolean, warnings: string[] }`.
   - Strategy v1: nearest-neighbor greedy from the depot (or first appointment if no depot). N is small (typical day = 3-10 stops); O(N²) is fine. Don't pull in a TSP library.
   - Skip canceled/no_show; include scheduled appointments only. timeLocked appointments anchor in place (their `startSuggested` equals their `scheduledStart`); other appointments arrange around them respecting drive-time and original durations.
   - Use the chunk-5 gmaps adapter (`distanceMatrix`) for drive times. One call with the N origins × N destinations gets you everything you need.

2. Tests (`route-optimization.test.ts`):
   - 0 appointments → empty stops + 0 drive time, no warnings
   - 3 unlocked appointments → returns 3 stops in greedy-optimal order, drive time summed
   - 1 locked appointment + 2 unlocked → locked stays in slot, unlocked order around it
   - No depot configured → first appointment used as anchor, warning surfaced
   - gmaps adapter error → service throws (let the route handler return 502)

== API routes ==

3. `apps/api/src/routes/appointments/today.ts` (or extend existing):
   - `GET /appointments/today/route` → returns the optimized order without persisting. Equivalent to "what would optimization recommend?"
   - Query params: `?date=YYYY-MM-DD` (defaults to today in tenant tz — if no tz field exists, use server tz with a TODO marker for chunk 22), `?vehicleId=...` (defaults to the tenant's default vehicle from chunk 9).
   - Tier gate: 403 if `tenant.plan` is `starter`/`unpaid`/`past_due`/`canceled`.
   - Returns the optimization service output as JSON. Drive times in minutes per the unit convention.

4. `POST /appointments/today/route/apply` → persists the suggested reschedules.
   - Body: `{ date, vehicleId, stops: Array<{ appointmentId, startSuggested }> }`.
   - Validate each appointment belongs to the tenant + matches the requested vehicleId.
   - Apply each shift via the existing chunk-9 reschedule path (so chunk-15 reminder reschedule hooks fire correctly).
   - Idempotency: if all `startSuggested` values match existing `scheduledStart`, return 200 + `{ applied: 0 }` with no DB writes.
   - Concurrency: wrap in a transaction; if any single reschedule fails (e.g., a slot was taken by a public-booking submit since the optimizer ran), rollback the whole apply and return 409 with `reason: 'concurrent_modification'`. The owner reruns optimization.

== Schema ==

5. Migration `20260524000000_appointment_time_locked`:
   - `Appointment.timeLocked Boolean @default(false)` — if chunk-9 didn't add this, add it now. If chunk-9 did, skip the migration. Check before authoring.
   - Tenant doesn't need a depot column if chunk-9 already added it. Same check.

== Web ==

6. `apps/web/src/routes/calendar/route-view.tsx` (or nest into the existing calendar route):
   - "Today's Route" tab/toggle on the day view.
   - List of stops in suggested order with: customer + pet name, service, time, address (truncated), drive time from prev stop ("12 min").
   - "Optimize" button (Pro+ only, disabled with upgrade nudge for Starter) → `GET /appointments/today/route` → displays the suggested order in a side-by-side compare against the current calendar order.
   - "Apply" button → `POST .../apply` → on success refreshes the calendar view; on 409 toast "Schedule changed since optimization — please re-run."
   - "Lock" toggle on individual appointments (already exists from chunk 9? if so wire up the UI here; if not add it). Locking prevents the optimizer from moving an appointment.

7. Map placeholder: v1 ships a static OpenStreetMap-style or Leaflet rendering with pins + connecting lines, OR a placeholder "Map view coming in chunk 21" message. Recommended: ship the simple Leaflet path (free tier) so the route view actually shows visual order. No tile customization, no Google Maps embed (avoid the billing entanglement until chunk 21+).

8. Web tests:
   - Route view renders the stops in returned order
   - Drive times formatted correctly ("12 min" not "12.4 minutes")
   - Optimize button disabled for Starter with upgrade copy
   - Apply success toast + Apply 409 toast both render

== Twin (only if needed) ==

9. v1 recommendation: don't extend twins/gmaps. The existing `distanceMatrix` endpoint is sufficient. If you find it isn't (e.g., for traffic-aware routing), extend the twin; but the spec doesn't ask for traffic-aware in this chunk.

== Env / docs ==

10. No new env in chunk 16.

11. README: add a "Route optimization in dev" subsection — how to seed a day of appointments + run the optimizer.

CONSTRAINTS (constitution)
- No file over 400 LOC. (Pre-existing 405-LOC calendar.test.tsx is chunk 9's — leave alone unless you touch it.)
- TS strict.
- No mention of Claude/Anthropic/OpenAI/Copilot anywhere.
- Light mode default.
- All external service calls via adapters. (gmaps adapter is the only outbound surface for route data.)
- Webhook signature verified FIRST. (No new webhooks this chunk.)
- Idempotency at every webhook handler. (No new webhooks.)
- Customer PII never logged.
- Drive times in minutes in serialized API responses; seconds is gmaps-internal only.

DONE WHEN
- Pro tenant viewing a day with 3+ appointments can hit "Optimize" and see a suggested reorder with drive times
- "Apply" persists the reschedules + chunk-15 reminder jobs reschedule correctly (no ghost jobs, no missing jobs)
- Locked appointment stays in place across optimization runs
- Starter tenant cannot reach the optimization route + UI shows upgrade nudge
- No-depot tenant gets a warning in the response + UI
- 0-appointment day returns clean empty state, no crash
- Concurrent modification (a customer submits a public booking between Optimize and Apply) → 409 with clear copy
- All chunk-1-through-15 tests still pass
- pnpm typecheck ✅, pnpm lint ✅, pnpm test ✅
- pnpm preflight && pnpm dev still up; full optimize → apply flow works in browser

OUT OF SCOPE
- Multi-vehicle dispatch (chunk 21)
- Traffic-aware routing (v2 — single distance-matrix call is fine for v1)
- TSP / branch-and-bound optimizers (greedy nearest-neighbor is fine at N=10)
- Live GPS / real-time tracking
- Map customization / branded tiles
- Drag-to-reorder on the route view (drag-to-reschedule on the calendar already exists from chunk 9; that's the primary edit affordance)
- Auto-apply on optimize (always two-step: optimize → review → apply)
- Per-leg ETA prediction with traffic (v2)
- Route export (PDF, share link) — chunk 22

WHEN DONE
Recap in <18 lines:
- Files added per area (service, route handlers, schema migration if any, web route view, tests)
- Greedy ordering correctness: any case where nearest-neighbor produced an obviously bad answer that a smarter algorithm would have fixed (and your judgment on whether to leave it for v2)
- timeLocked field: did chunk 9 already add it, or did you add the migration here
- Two-step apply flow: did the 409 concurrent-modification case need extra plumbing or was the transaction enough
- Drive-time unit conversion: was the seconds → minutes boundary clean, or did seconds leak into web fixtures
- Map rendering: Leaflet vs static placeholder — your call + what you shipped
- Chunk-15 reminder reschedule on apply: did the existing hooks fire correctly, or did you have to wire something
- Any spec ambiguity for chunk 17 (recurring appointments) you noticed while reading — esp. how recurring series interact with the route-optimization "apply" path

Hold for eval. Don't start chunk 17. Don't do unsolicited cleanup past the recap.
```

---

## After chunk 16

Replace this file with the chunk 17 prompt. Chunk 17 builds recurring appointments (every-N-weeks series, edit-one vs edit-all, generation horizon). Spec ambiguities to lock first:

- How far in the future the system pre-generates Appointment rows from a series (one occurrence ahead? a rolling 90-day window? generate-on-demand?)
- Edit-one-vs-edit-all UX: when an owner reschedules an occurrence, which is the default
- What happens to a series when the parent customer is soft-deleted
- Reminder scheduling: when chunk-15 reminders for a series fire, do they re-render the template with whatever the appointment's current snapshot is, or with the snapshot at occurrence-creation time
