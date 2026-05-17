import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '@mygroomtime/db';
import { createApp as createStripeTwin, type TwinAppHandle } from '@mygroomtime/twin-stripe';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createStripeAdapter } from '../../adapters/stripe/index.js';
import { makeTestEnv } from '../../test-utils/env.js';

const PREFIX = 'billing-flow-test-';
const WEBHOOK_SECRET = 'whsec_test_unused';

async function cleanup(): Promise<void> {
  const rows = await db.global.tenant.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const t of rows) await db.global.tenant.delete({ where: { id: t.id } });
  await db.global.webhookEvent.deleteMany({ where: { eventId: { startsWith: 'evt_TWIN_' } } });
}

async function signup(
  app: FastifyInstance,
  suffix: string,
): Promise<{ cookie: string; tenantId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: {
      email: `${suffix}@example.test`,
      password: 'a-strong-password',
      businessName: `${PREFIX}${suffix}`,
    },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  const cookie = cookieStr.split(';')[0]!;
  const body = res.json() as { tenant: { id: string } };
  return { cookie, tenantId: body.tenant.id };
}

describe('billing flow — signup → checkout → webhook flips plan', () => {
  let app: FastifyInstance;
  let twin: TwinAppHandle;
  let twinUrl: string;
  let apiBaseUrl: string;
  let apiHttp: FastifyInstance;

  beforeAll(async () => {
    twin = createStripeTwin({ logger: false, webhookSecret: WEBHOOK_SECRET });
    await twin.app.listen({ port: 0, host: '127.0.0.1' });
    const taddr = twin.app.server.address();
    if (!taddr || typeof taddr === 'string') throw new Error('twin address missing');
    twinUrl = `http://127.0.0.1:${taddr.port}`;
    twin.setPublicOrigin(twinUrl);

    const env = makeTestEnv();
    const envWithStripe = {
      ...env,
      stripe: { ...env.stripe, webhookSecret: WEBHOOK_SECRET, twinUrl },
    };
    apiHttp = await createApp({
      logger: false,
      env: envWithStripe,
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
      adapters: {
        stripe: createStripeAdapter({
          mode: 'twin',
          secretKey: 'sk_test',
          webhookSecret: WEBHOOK_SECRET,
          twinUrl,
        }),
      },
    });
    await apiHttp.listen({ port: 0, host: '127.0.0.1' });
    const addr = apiHttp.server.address();
    if (!addr || typeof addr === 'string') throw new Error('api address missing');
    apiBaseUrl = `http://127.0.0.1:${addr.port}`;
    twin.cfg.url = `${apiBaseUrl}/webhooks/stripe`;
    app = apiHttp;
  });

  afterAll(async () => {
    await cleanup();
    await apiHttp.close();
    await twin.app.close();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it('full flow: signup unpaid → POST /billing/checkout → auto-complete → webhook flips plan', async () => {
    const t = await signup(app, 'full');
    expect(t.tenantId).toBeTruthy();

    const me0 = await app.inject({ method: 'GET', url: '/me', headers: { cookie: t.cookie } });
    expect((me0.json() as { tenant: { plan: string } }).tenant.plan).toBe('unpaid');

    const checkout = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { cookie: t.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ tier: 'starter' }),
    });
    expect(checkout.statusCode).toBe(200);
    const { url } = checkout.json() as { url: string };
    expect(url).toContain('/checkout/');

    const completeRes = await fetch(`${url}?auto=1`, { redirect: 'manual' });
    expect(completeRes.status).toBe(302);

    let plan = 'unpaid';
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: t.cookie } });
      const parsed = me.json() as { tenant: { plan: string } };
      plan = parsed.tenant.plan;
      if (plan !== 'unpaid') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(plan).toBe('starter');

    const tenant = await db.global.tenant.findUnique({ where: { id: t.tenantId } });
    expect(tenant?.stripeSubscriptionId).toMatch(/^sub_TWIN_/);
    expect(tenant?.stripeCustomerId).toMatch(/^cus_TWIN_/);
  });

  it('GET /billing/portal returns 501 (chunk 13)', async () => {
    const t = await signup(app, 'portal');
    const res = await app.inject({
      method: 'GET',
      url: '/billing/portal',
      headers: { cookie: t.cookie },
    });
    expect(res.statusCode).toBe(501);
  });
});
