# MyGroomTime

Scheduling and client-management SaaS for mobile dog groomers.

This repo holds two things:

- **The app** — `apps/`, `packages/`, `spec/`, `scenarios/`, `twins/`. The actual product.
- **The landing page** — `index.html`, `assets/`, `CNAME`. Static marketing site served at [mygroomtime.com](https://mygroomtime.com) via GitHub Pages.

## Getting started (app)

Prereqs:

- Node 22+
- pnpm 9+
- Docker Desktop **running** (the daemon must be up before `pnpm dev`)

```bash
pnpm i && pnpm dev
```

`pnpm preflight` checks the Docker daemon by itself if you want to verify before booting.

That brings up:

- Web → http://localhost:5173
- API → http://localhost:3000 (try `/healthz`)
- Postgres → localhost:5433 (avoids clashing with a native Postgres install on 5432)
- Redis → localhost:6379

Stop the local services with `pnpm docker:down`.

## Layout

```
apps/web        React + Vite PWA (groomer app + public booking page)
apps/api        Fastify HTTP API
packages/db     Prisma schema + client
packages/shared Zod schemas shared between web and api
twins/          External-service twins (deterministic stand-ins for Stripe, Twilio, Google Maps, Google Calendar)
spec/           Source-of-truth product + architecture + plan
scenarios/      Holdout behavioral tests (do not read during implementation)
index.html      Landing page (served at mygroomtime.com)
assets/         Landing-page brand assets
```

## Running twins

Each external integration ships with a "twin" — a separate process that speaks the same wire protocol as the real service but is deterministic, free, and safe in tests. The api picks live vs. twin per service via `<SERVICE>_MODE=live|twin`. In dev the default is `twin` for everything.

The twins aren't auto-started by `pnpm dev` — they'd be noise until you actually exercise one. Start the ones you need:

```bash
pnpm twin:gmaps       # Google Maps Distance Matrix on :4245
pnpm twin:geocode     # Google Geocoding on :4246
pnpm twin:stripe      # Stripe REST + webhooks on :4242
```

Run each twin only when the feature you're touching uses that adapter in twin mode (the default). Address-creating flows (new client, public booking submit) need the geocode twin; routing/availability flows need the gmaps twin. Subscription billing (signup → Checkout) needs the Stripe twin.

The Stripe twin renders a hosted-checkout page that you can click through, or you can append `?auto=1` to the Checkout URL to complete + fire the webhook in one hop — handy for automated flows.

## Landing page

The static site at the repo root (`index.html` + `assets/` + `CNAME`) is served by GitHub Pages at [mygroomtime.com](https://mygroomtime.com). Edit those files directly to ship landing-page changes; no build step.
