# Scenario: Connection drops mid-route, mutations queue, replay on reconnect

**Persona:** Maria, mid-day, driving into a dead zone in rural east Plano.

**Context:** She's on appointment 3 of 6. Already completed 2 and marked them. Currently has the app open on the day's route view. Phone shows "No service" or "5G" toggling.

## Steps

1. Maria taps "Started" on appointment 3 (Max). Connection is fine. Server receives, ack within 1s.
2. While grooming Max, connection drops. The PWA's service worker detects offline.
3. Maria finishes Max, taps "Complete" → tip prompt → picks 20%. The optimistic UI shows the appointment as complete.
4. App displays a discreet banner: "Offline — 1 change queued."
5. She drives 10 minutes to appointment 4 (Daisy). Still offline.
6. Taps "On the way" on Daisy. Banner: "Offline — 2 changes queued."
7. Arrives, taps "Started." Banner: "Offline — 3 changes queued."
8. Connection comes back. Service worker fires queued mutations in order.
9. Each succeeds. Banner updates: "Syncing… 2 left" → "Syncing… 1 left" → "All caught up."
10. The 2h-ETA SMS to Daisy's owner — which would normally fire at "On the way" — fires now, not retroactively at the moment Maria tapped "On the way." (Or: fires retroactively but with current-time ETA, not stale ETA. Spec must pick one. Default: fire now with current ETA.)
11. Tip + balance capture for Max happens on reconnect, not on tap. Stripe charge succeeds.

## Satisfaction criteria

- Today's route is cached client-side at app open. The route view renders fully without a network request after the initial load.
- Offline mutations are stored in IndexedDB with a stable client-generated id (so the server can dedupe on reconnect).
- The replay order is the order they were created on the client, not the order they reach the server.
- Server-side deduplication uses the client-generated id: replaying the same mutation twice results in one effect, not two.
- The "Started" → "Complete" sequence with a 75-minute gap, while offline, persists the gap correctly when it syncs (started_at and completed_at timestamps come from the client, not the server's receive time).
- The Stripe charge for Max's balance executes on the server, not the client, after sync. The client never holds the Stripe key.
- If the Stripe charge fails (declined card on file), the appointment is still marked complete but a flag is raised: in-app notification "Couldn't capture Max's balance — see the appointment for retry options."
- The 2h-ETA SMS that would have fired at "On the way" handles the offline case sensibly. Default: fire with current time as the new "now" when sync happens. Acceptable alternative: skip if it's already past the appointment time.
- The "offline / queued" banner is informative but not alarming. No red, no skull icons. Neutral color, small footprint, top of viewport.
- If the user closes and reopens the app while offline, the queued mutations are still there (persisted, not in-memory).
- If a queued mutation fails permanently on replay (e.g., the server rejects it because the appointment was deleted by another user), the user sees a clear conflict resolution screen for that mutation, not a generic error.
