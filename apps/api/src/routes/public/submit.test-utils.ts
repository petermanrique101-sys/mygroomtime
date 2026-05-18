import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import {
  createApp as createStripeTwinApp,
  type TwinAppHandle,
} from '@mygroomtime/twin-stripe';
import { db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { createStripeAdapter } from '../../adapters/stripe/index.js';
import { makeTestEnv } from '../../test-utils/env.js';

export const WEBHOOK_SECRET = 'whsec_submit_test';

export type SubmitTestHarness = {
  app: FastifyInstance;
  geocodeTwin: FastifyInstance;
  stripeTwin: TwinAppHandle;
  close: () => Promise<void>;
};

export async function createSubmitTestHarness(): Promise<SubmitTestHarness> {
  const geocodeTwin = createGeocodeTwinApp({ logger: false });
  await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
  const geocodePort = (geocodeTwin.server.address() as { port: number }).port;
  const geocodeTwinUrl = `http://127.0.0.1:${geocodePort}`;

  const stripeTwin = createStripeTwinApp({
    logger: false,
    webhookUrl: null,
    webhookSecret: WEBHOOK_SECRET,
  });
  await stripeTwin.app.listen({ port: 0, host: '127.0.0.1' });
  const stripePort = (stripeTwin.app.server.address() as { port: number }).port;
  const stripeTwinUrl = `http://127.0.0.1:${stripePort}`;
  stripeTwin.setPublicOrigin(stripeTwinUrl);

  const env = makeTestEnv();
  env.stripe.webhookSecret = WEBHOOK_SECRET;
  env.stripe.twinUrl = stripeTwinUrl;
  const app = await createApp({
    logger: false,
    env,
    sessionStore: createMemorySessionStore(),
    emailAdapter: createStdoutEmailAdapter(),
    adapters: {
      geocode: createGeocodeAdapter({ mode: 'twin', apiKey: '', twinUrl: geocodeTwinUrl }),
      stripe: createStripeAdapter({
        mode: 'twin',
        secretKey: 'sk_test',
        webhookSecret: WEBHOOK_SECRET,
        twinUrl: stripeTwinUrl,
      }),
    },
  });

  return {
    app,
    geocodeTwin,
    stripeTwin,
    close: async () => {
      await app.close();
      await geocodeTwin.close();
      await stripeTwin.app.close();
    },
  };
}

export async function fetchTenantSlug(tenantId: string): Promise<string> {
  const t = await db.global.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });
  if (!t) throw new Error('tenant not found');
  return t.slug;
}

export async function promoteWithConnect(
  tenantId: string,
  accountId = 'acct_TWIN_test',
): Promise<void> {
  await db.global.tenant.update({
    where: { id: tenantId },
    data: {
      plan: PlanTier.pro,
      stripeConnectAccountId: accountId,
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    },
  });
}

export function nextNonSunday(daysAhead: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

export function customer(
  overrides: Partial<{ phone: string; email: string; zip: string }> = {},
): {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  return {
    firstName: 'Carlos',
    lastName: 'Reyes',
    phone: overrides.phone ?? '+19725550199',
    email: overrides.email ?? 'carlos@example.test',
    street: '1234 Oak St',
    city: 'Plano',
    state: 'TX',
    zip: overrides.zip ?? '75024',
  };
}

export function pet(): {
  name: string;
  breed: string;
  weightLb: number;
  coatType: 'short';
  temperamentNotes: string;
} {
  return { name: 'Bruno', breed: 'Beagle', weightLb: 25, coatType: 'short', temperamentNotes: '' };
}
