# Twin: Twilio

A tiny HTTP server that speaks Twilio's Messages API and delivers status callbacks + inbound message webhooks. No real phone numbers are sent.

## Endpoints

- `POST /2010-04-01/Accounts/:sid/Messages.json` — send SMS. Returns a Message resource with `sid: SM_TWIN_<n>`, `status: queued`.

Body params (form-urlencoded, like real Twilio):
- `From` — must match `TWILIO_FROM_NUMBER` env or returns 21606
- `To` — any E.164 string
- `Body` — message text
- `StatusCallback` — URL to POST status updates

## Status callback delivery

After accepting a message, the twin fires status callbacks at the configured URL on a timeline:

- `queued` (immediate, in response)
- `sent` (250ms later)
- `delivered` (1.5s later) — unless the `To` number matches a configured failure pattern

Bodies follow Twilio's wire format:
```
POST {status_callback}
X-Twilio-Signature: <base64 hmac>
Body: MessageSid=SM_TWIN_123&MessageStatus=delivered&To=...&From=...
```

## Failure patterns (deterministic by phone number)

Last digit of `To` controls behavior — so tests are reproducible:

| Last digit | Outcome                                          |
|------------|--------------------------------------------------|
| 0          | delivered                                        |
| 1          | undelivered (carrier rejection)                  |
| 2          | failed (invalid number)                          |
| 3          | delivered after 30s delay                        |
| 9          | delivered, plus auto-replies "STOP" 2s later     |

## Inbound message simulation

For scenarios that need an inbound reply (scenario 04 — Jane replies "R"; scenario 06 — Sarah replies "STOP"), the twin exposes:

- `POST /__twin__/inbound { from, to, body }` — fires an inbound webhook at the configured URL.

Wire shape matches Twilio:
```
POST {inbound_webhook_url}
X-Twilio-Signature: <base64 hmac>
Body: MessageSid=SM_TWIN_in_456&From=...&To=...&Body=R&NumMedia=0
```

## Signature

`X-Twilio-Signature` is computed the same way real Twilio does (SHA-1 HMAC of URL + sorted form params with `TWILIO_AUTH_TOKEN`). Adapter must verify identically.

## STOP / START handling

The twin honors STOP / UNSUBSCRIBE / CANCEL replies internally — if a number sends STOP, subsequent outbound to that number from the same `From` returns 21610 (recipient has opted out). This matches real Twilio's auto-unsubscribe behavior. The adapter does NOT need to track opt-out at the carrier level; the twin does it.

The application-level `Client.sms_opt_out` flag is separate and lives in MyGroomTime's own DB — this is what scenario 06 exercises.

## State

In-memory, resets on restart. Admin endpoint to inspect:

- `GET /__twin__/messages` — list all messages sent and received in this session
- `GET /__twin__/opt-outs` — list numbers that have STOP'd
- `POST /__twin__/reset` — clear state

## Not supported

- MMS (no media yet)
- Voice
- WhatsApp
- Real carrier integration
