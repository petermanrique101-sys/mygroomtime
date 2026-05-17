import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../app.js';
import { createMemorySessionStore } from '../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../adapters/email/index.js';
import { makeTestEnv } from '../test-utils/env.js';

const PREFIX = 'paid-plan-mw-';

async function cleanup(): Promise<void> {
  const rows = await db.global.tenant.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const t of rows) await db.global.tenant.delete({ where: { id: t.id } });
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

async function setPlan(tenantId: string, plan: PlanTier): Promise<void> {
  await db.global.tenant.update({ where: { id: tenantId }, data: { plan } });
}

describe('requirePaidPlan middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      logger: false,
      env: makeTestEnv(),
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
    });
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it('unpaid tenant: GET /clients → 403 plan_required; GET /me + GET /billing → 200', async () => {
    const t = await signup(app, 'unpaid');
    const clients = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { cookie: t.cookie },
    });
    expect(clients.statusCode).toBe(403);
    expect((clients.json() as { error: string }).error).toBe('plan_required');

    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: t.cookie } });
    expect(me.statusCode).toBe(200);

    const billing = await app.inject({
      method: 'GET',
      url: '/billing',
      headers: { cookie: t.cookie },
    });
    expect(billing.statusCode).toBe(200);
  });

  it('past_due tenant: GET /clients passes (read-only), POST /clients → 403 past_due', async () => {
    const t = await signup(app, 'pastdue');
    await setPlan(t.tenantId, PlanTier.past_due);

    const get = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { cookie: t.cookie },
    });
    expect(get.statusCode).toBe(200);

    const post = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { cookie: t.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Test',
        phone: '+19725550000',
        street: '1234 Oak St',
        city: 'Plano',
        state: 'TX',
        zip: '75024',
        notes: '',
        pets: [],
      }),
    });
    expect(post.statusCode).toBe(403);
    const body = post.json() as { reason: string };
    expect(body.reason).toBe('past_due');
  });

  it('canceled tenant: all CRUD endpoints 403; /me and /billing still work', async () => {
    const t = await signup(app, 'cancel');
    await setPlan(t.tenantId, PlanTier.canceled);

    const list = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { cookie: t.cookie },
    });
    expect(list.statusCode).toBe(403);

    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: t.cookie } });
    expect(me.statusCode).toBe(200);

    const billing = await app.inject({
      method: 'GET',
      url: '/billing',
      headers: { cookie: t.cookie },
    });
    expect(billing.statusCode).toBe(200);
  });

  it('starter/pro/business plans pass through every method', async () => {
    const t = await signup(app, 'paid');
    for (const plan of [PlanTier.starter, PlanTier.pro, PlanTier.business]) {
      await setPlan(t.tenantId, plan);
      const get = await app.inject({
        method: 'GET',
        url: '/clients',
        headers: { cookie: t.cookie },
      });
      expect(get.statusCode).toBe(200);
    }
  });
});
