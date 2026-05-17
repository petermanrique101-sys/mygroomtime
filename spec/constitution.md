# Constitution — MyGroomTime

Non-negotiables. The build respects these no matter what looks clever in the moment.

## Code
- TypeScript strict everywhere. No `any`. No `as` cast without an inline `// why:` comment.
- No file over 400 LOC. If it grows past, split by responsibility before adding the next feature.
- One responsibility per module. No god files (no `utils.ts`, `helpers.ts`, `lib.ts`).
- No comments, docstrings, or type annotations added to code that wasn't touched in the same change.
- No mentions of AI tools (Claude, Anthropic, OpenAI, Copilot) in commits, PRs, code, or docs.
- No `Co-authored-by` lines from AI in commits.

## Architecture
- All external service calls (Stripe, Twilio, Google Calendar, Google Maps) go through an adapter in `apps/api/src/adapters/<service>/`. The rest of the code talks to the adapter, never the SDK directly. This is the seam where [[twin-services]] plug in.
- Multi-tenant from line one. Every row that isn't global has a `tenantId`. Every query is scoped by tenant. No global queries in request handlers.
- Background work (SMS sends, recurring rebooks, route recomputes) runs in a job queue, not inline in the request. Failures are retried with backoff and surface to an operator log.
- Postgres is the single source of truth. No second store for "performance" without an explicit decision in [[architecture]].

## Product UX
- Mobile-first. Phone-sized viewport (375x812) is the primary target. Desktop is a bonus, not the default.
- Light mode default. No dark mode unless the user explicitly asks later.
- Every destructive action (delete client, cancel appointment, void deposit) is reversible within 30 days OR gated by an explicit confirm step with the cost stated ("This will refund $40 to the customer. Continue?").
- Errors surface to the user with actionable text. No silent fallback. No "Something went wrong" — name the thing and what to do.
- Offline-tolerant scheduling: today's route is cached client-side and any mutations queue locally, replay on reconnect. Conflict resolution is "server wins, surface the diff to the groomer."

## Security & data
- No secrets in code. All config via env vars. `.env.example` checked in with placeholder values; `.env` gitignored.
- PII (owner phone, address, pet medical notes) is never logged. Stripe and Twilio webhook signatures are verified on every request.
- Public booking page is rate-limited per IP and per groomer subdomain. No auth on it but no anonymous mass-write either.

## Process
- Spec is the source of truth. When spec and code disagree, the spec wins and code is regenerated.
- [[holdout-scenarios]] are the quality gate. A chunk isn't done until the scenarios that touch it pass.
- Out-of-scope items go to a v2 list, not into the current build.
