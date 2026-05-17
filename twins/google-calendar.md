# Twin: Google Calendar

A tiny HTTP server that speaks enough of the Google Calendar v3 API for MyGroomTime's two-way sync. Avoids OAuth flow + real calendar pollution.

## OAuth substitute

Real Google Calendar requires OAuth. The twin shortcuts it:

- `GET /oauth/auth?redirect_uri=...&state=...` — immediately redirects to `redirect_uri?code=TWIN_CODE_<n>&state=...`
- `POST /oauth/token` — exchanges code for `{ access_token: "twin_at_<n>", refresh_token: "twin_rt_<n>", expires_in: 3600 }`
- `POST /oauth/token` with `grant_type=refresh_token` — returns a new access_token

No real Google account needed. The "user" identity is `twin-user-<n>@mygroomtime.test`.

## Calendar API endpoints

- `GET /calendar/v3/users/me/calendarList` — list calendars (twin returns one "primary" calendar per access token)
- `GET /calendar/v3/calendars/:calId/events` — list events, supports `syncToken` for incremental sync
- `POST /calendar/v3/calendars/:calId/events` — insert event
- `PATCH /calendar/v3/calendars/:calId/events/:eventId` — update event
- `DELETE /calendar/v3/calendars/:calId/events/:eventId`
- `POST /calendar/v3/calendars/:calId/events/watch` — register push notification channel

## Push notifications (for incoming changes)

When the user creates an event externally (in real Google Calendar UI), Google POSTs a notification to MyGroomTime so it can pull deltas. The twin simulates this via:

- `POST /__twin__/external-event-created { calendarId, summary, start, end }` — inserts an event AND fires the watch-channel notification at the configured webhook URL.

Notification body matches Google's shape:
```
POST {watch_webhook}
X-Goog-Channel-Id: <channel>
X-Goog-Resource-State: exists
X-Goog-Resource-Id: <calId>
```

## Sync token semantics

The twin issues opaque `syncToken` strings. Subsequent calls with that token return only events changed since the token was issued. Tokens are stable across the twin process lifetime; restart invalidates them (returns 410 like real Google, forcing a full resync).

## Two-way sync behavior the twin enforces

To make scenarios real:

- An event created via MyGroomTime → POST to twin → twin stores it → subsequent list returns it.
- An event created externally (via the `__twin__/external-event-created` endpoint) → twin stores it → fires watch notification → MyGroomTime polls deltas → ingests it.
- An update on either side propagates. Conflict resolution rule: **last-write-wins by `updated` timestamp**. (If the spec needs different conflict logic later, add it here.)

## Not supported

- Recurring events (`RRULE`). For v1, recurring grooming series live in MyGroomTime's DB and are projected as individual events to Google.
- Multiple calendars per user.
- ACL changes / sharing.
- Reminders / notification preferences.
