# Architecture — MyGroomTime

## Stack

- **Frontend:** React 18 + Vite + TypeScript. Tailwind for styling. TanStack Query for server state. React Router. PWA shell via `vite-plugin-pwa` for offline today-route caching.
  - *Why:* phone-first, fast first paint, easy PWA story.
- **Backend:** Fastify + TypeScript. Zod for request/response schemas. Prisma for DB. BullMQ on Redis for background jobs.
  - *Why:* lower per-request overhead than Express at the cost of nothing meaningful; Zod gives us shared schemas with the frontend via `packages/shared`.
- **Database:** Postgres 16 (managed — Neon or RDS in prod, Docker locally). Prisma migrations.
- **Cache / queue:** Redis (Upstash in prod, Docker locally). Sessions live in Redis; jobs live in BullMQ on Redis.
- **Hosting:** Vercel for `apps/web`, Fly.io (or Render) for `apps/api`. Single region us-east to start.
- **Auth:** session cookie, server-issued, http-only, SameSite=Lax. Passwords hashed with argon2id. Magic links as fallback (signed token in email).

## Repo layout (monorepo, pnpm workspaces)

```
mygroomtime/
├── apps/
│   ├── web/                  ← React + Vite, the PWA
│   │   ├── src/
│   │   │   ├── routes/       ← one folder per route, max 400 LOC each
│   │   │   ├── features/     ← feature-scoped UI (calendar, clients, billing)
│   │   │   ├── lib/          ← api client, offline queue, hooks
│   │   │   └── main.tsx
│   │   └── vite.config.ts
│   └── api/                  ← Fastify
│       ├── src/
│       │   ├── routes/       ← one file per resource (clients.ts, appts.ts)
│       │   ├── adapters/     ← the seam: stripe/, twilio/, gcal/, gmaps/
│       │   ├── jobs/         ← BullMQ workers
│       │   ├── middleware/
│       │   └── server.ts
│       └── package.json
├── packages/
│   ├── db/                   ← Prisma schema, migrations, client export
│   │   ├── prisma/
│   │   └── src/index.ts
│   └── shared/               ← Zod schemas, TS types shared web↔api
│       └── src/
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Component layout

```
                ┌────────────────────────┐
  Dog owner ──▶ │  apps/web (PWA)         │
                │  - public booking page  │ ◀── slug.mygroomtime.com
                │  - groomer app (auth)   │ ◀── app.mygroomtime.com
                └───────┬─────────────────┘
                        │ JSON over HTTPS
                ┌───────▼─────────────────┐
                │  apps/api (Fastify)     │
                │  - REST handlers        │
                │  - middleware           │
                │  - adapters/            │
                └───┬───────┬──────┬──────┘
                    │       │      │
        ┌───────────▼──┐ ┌──▼───┐ ┌▼────────────────┐
        │ Postgres     │ │Redis │ │ External APIs   │
        │ (Prisma)     │ │      │ │ via adapters:   │
        └──────────────┘ │ Bull │ │ - Stripe        │
                         │ MQ   │ │ - Twilio        │
                         │ Sess │ │ - Google Cal    │
                         └──────┘ │ - Google Maps   │
                                  │ - Geocoding     │
                                  └─────────────────┘
```

## Adapter boundary

Every external service has the same shape. Example for Stripe:

```
apps/api/src/adapters/stripe/
  ├── index.ts          ← exports the typed interface
  ├── live.ts           ← real Stripe SDK implementation
  └── types.ts          ← request/response shapes
```

`index.ts` exports `createStripeAdapter(env)`. At app boot, we pick `live` when `STRIPE_MODE=live`. The twin (see `twins/stripe.md`) is a separate process that speaks the same wire protocol; nothing inside `apps/api` knows which is connected — that's the point.

The same pattern applies to Twilio, Google Calendar, Google Maps Distance Matrix, and Google Geocoding (added during chunk 6 build — addresses-in needs lat/lng-out and Distance Matrix doesn't geocode).

## Multi-tenancy

- Every non-global row has `tenant_id` (FK to `tenants.id`).
- A Fastify `preHandler` resolves the tenant from the session and attaches it to the request context.
- Prisma queries always go through a thin wrapper (`db.forTenant(tenantId)`) that injects `tenantId` into every where-clause. Raw `prisma.x.findMany()` without that wrapper is a lint error.
- The public booking page resolves tenant from the subdomain (`slug.mygroomtime.com`) and treats the request as anonymous-but-tenant-scoped.

## Auth

- Email + password (argon2id). Session cookie issued on login, signed, http-only, 14-day sliding expiry.
- Magic link: signed token (jose) emailed via SES (in prod) or stdout (in dev), TTL 15min, single-use.
- Roles enforced in middleware: `requireRole('owner' | 'dispatcher' | 'groomer')`.
- Groomers invited by owners receive a one-time setup link.

## Data store and migrations

- Prisma migrate. Migrations checked into git under `packages/db/prisma/migrations`.
- Every migration must be backwards-compatible with the previous deployed code for one release cycle (add column nullable → backfill → make required in next release).
- Seed script (`packages/db/src/seed.ts`) creates one demo tenant with 5 clients, 8 pets, 3 services for local dev.

## Jobs (BullMQ)

Queues:
- `sms-outbound` — sends scheduled reminders (48h, 2h-on-the-way, post-appt review)
- `recurring-rebook` — runs nightly, materializes the next concrete appointment for each active RecurringSeries whose next-due falls within 14 days
- `route-recompute` — fires when an appointment is added/moved/canceled for today; recomputes route via the Google Maps adapter
- `stripe-balance` — fires when an appointment is marked complete; captures the balance + tip

All jobs are idempotent (job id keyed on the entity + action), retried with exponential backoff up to 5 attempts, then sent to a dead-letter queue surfaced in the operator log.

## Deployment

- `apps/web`: Vercel project, deploys on push to `main`. Preview deploys per PR.
- `apps/api`: Fly.io app, deploys via `flyctl deploy` from CI. Single region (iad) v1.
- Postgres: Neon (prod), Docker (local).
- Redis: Upstash (prod), Docker (local).
- Secrets: Fly secrets (api), Vercel env vars (web). `.env.example` in repo.
- Subdomain wildcards: `*.mygroomtime.com` CNAME to Vercel for tenant booking pages.

## Observability

- Structured JSON logs (pino). PII redacted at the logger level.
- Error tracking: Sentry (web + api).
- Uptime: a simple `/healthz` polled by an external service.
- Operator log table: failed jobs, webhook processing failures, payment edge cases surface in an in-app `/operator` view (owner-role only).
