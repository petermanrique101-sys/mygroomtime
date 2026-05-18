import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createApp as createStripeTwin,
  type TwinAppHandle,
  signPayload,
} from '@mygroomtime/twin-stripe';
import { db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createStripeAdapter } from '../../adapters/stripe/index.js';
import { makeTestEnv } from '../../test-utils/env.js';

const PREFIX = 'billing-set-test-';
const WEBHOOK_SECRET = 'whsec_billing_set';

async function cleanup(): Promise<void> {
  const rows = await db.global.tenant.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const t of rows) await db.global.tenant.delete({ where: { id: t.id } });
  await db.global.webhookEvent.deleteMany({
    where: { eventId: { startsWith: 'evt_TWIN_' } },
  });
}

async function signupAndCheckout(
  app: FastifyInstance,
  twinHook: () => Promise<void>,
  suffix: string,
  tier: 'starter' | 'pro' | 'business' = 'starter',
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
  if (res.statusCode !== 201) throw new Error(`signup: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  const cookie = cookieStr.split(';')[0]!;
  const body = res.json() as { tenant: { id: string } };

  const checkout = await app.inject({
    method: 'POST',
    url: '/billing/checkout',
    headers: { cookie, 'content-type': 'application/json' },
    payload: JSON.stringify({ tier }),
  });
  if (checkout.statusCode !== 200) throw new Error(`checkout: ${checkout.statusCode}`);
  const { url } = checkout.json() as { url: string };
  await fetch(`${url}?auto=1`, { redirect: 'manual' });
  await twinHook();

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const t = await db.global.tenant.findUnique({
      where: { id: body.tenant.id },
      select: { plan: true, stripeSubscriptionItemId: true },
    });
    if (t?.plan === tier && t.stripeSubscriptionItemId) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return { cookie, tenantId: body.tenant.id };
}

describe('/settings/billing — preview + change + portal', () => {
  let app: FastifyInstance;
  let twin: TwinAppHandle;
  let twinUrl: string;
  let apiBaseUrl: string;

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
    app = await createApp({
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
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('api address missing');
    apiBaseUrl = `http://127.0.0.1:${addr.port}`;
    twin.cfg.url = `${apiBaseUrl}/webhooks/stripe`;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await twin.app.close();
  });

  beforeEach(async () => {
    await cleanup();
  });

  async function twinSettle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 150));
  }

  it('GET /settings/billing returns plan + tier matrix', async () => {
    const t = await signupAndCheckout(app, twinSettle, `get-${Date.now()}`);
    const res = await app.inject({
      method: 'GET',
      url: '/settings/billing',
      headers: { cookie: t.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: string;
      available: Array<{ tier: string; priceMonthlyCents: number }>;
    };
    expect(body.plan).toBe('starter');
    expect(body.available).toHaveLength(3);
    expect(body.available.find((a) => a.tier === 'pro')?.priceMonthlyCents).toBe(9900);
  });

  it('preview-plan-change returns positive charge for upgrade', async () => {
    const t = await signupAndCheckout(app, twinSettle, `up-${Date.now()}`);
    const res = await app.inject({
      method: 'POST',
      url: '/settings/billing/preview-plan-change',
      headers: { cookie: t.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ targetPlan: 'business' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      amountDueCents: number;
      chargeCents: number;
      creditCents: number;
      nextChargeCents: number;
    };
    expect(body.amountDueCents).toBeGreaterThan(0);
    expect(body.chargeCents).toBeGreaterThan(0);
    expect(body.creditCents).toBe(0);
    expect(body.nextChargeCents).toBe(14900);
  });

  it('preview-plan-change returns positive credit for downgrade', async () => {
    const t = await signupAndCheckout(app, twinSettle, `dn-${Date.now()}`, 'business');
    const res = await app.inject({
      method: 'POST',
      url: '/settings/billing/preview-plan-change',
      headers: { cookie: t.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ targetPlan: 'starter' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      amountDueCents: number;
      creditCents: number;
      chargeCents: number;
    };
    expect(body.amountDueCents).toBe(0);
    expect(body.creditCents).toBeGreaterThan(0);
    expect(body.chargeCents).toBe(0);
  });

  it('preview-plan-change rejects same-plan with 400', async () => {
    const t = await signupAndCheckout(app, twinSettle, `same-${Date.now()}`);
    const res = await app.inject({
      method: 'POST',
      url: '/settings/billing/preview-plan-change',
      headers: { cookie: t.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ targetPlan: 'starter' }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toBe('same_plan');
  });

  it('preview-plan-change blocks past_due with 403', async () => {
    const t = await signupAndCheckout(app, twinSettle, `pd-${Date.now()}`);
    await db.global.tenant.update({
      where: { id: t.tenantId },
      data: { plan: PlanTier.past_due },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/billing/preview-plan-change',
      headers: { cookie: t.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ targetPlan: 'pro' }),
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: string; reason: string };
    expect(body.error).toBe('plan_change_blocked');
    expect(body.reason).toBe('past_due');
  });

  it('change-plan returns 202 and the webhook flips plan within seconds', async () => {
    const t = await signupAndCheckout(app, twinSettle, `chg-${Date.now()}`);
    const res = await app.inject({
      method: 'POST',
      url: '/settings/billing/change-plan',
      headers: { cookie: t.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ targetPlan: 'pro' }),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { pending: boolean; willTakeEffect: string };
    expect(body.pending).toBe(true);
    expect(body.willTakeEffect).toBe('webhook');

    let plan: string | null = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const row = await db.global.tenant.findUnique({
        where: { id: t.tenantId },
        select: { plan: true },
      });
      plan = row?.plan ?? null;
      if (plan === 'pro') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(plan).toBe('pro');

    const change = await db.global.tenantPlanChange.findFirst({
      where: { tenantId: t.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    expect(change?.fromPlan).toBe('starter');
    expect(change?.toPlan).toBe('pro');
  });

  it('portal-session returns a redirectable URL', async () => {
    const t = await signupAndCheckout(app, twinSettle, `por-${Date.now()}`);
    const res = await app.inject({
      method: 'POST',
      url: '/settings/billing/portal-session',
      headers: { cookie: t.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string };
    expect(body.url).toContain('/__twin_billing_portal/');
    const hit = await fetch(body.url, { redirect: 'manual' });
    expect(hit.status).toBe(200);
  });

  it('replaying customer.subscription.updated does not double-record the plan change', async () => {
    const t = await signupAndCheckout(app, twinSettle, `rep-${Date.now()}`);
    const tenant = await db.global.tenant.findUnique({
      where: { id: t.tenantId },
      select: { stripeSubscriptionId: true, stripeSubscriptionItemId: true },
    });

    const payload = JSON.stringify({
      id: 'evt_TWIN_replay_test',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: tenant!.stripeSubscriptionId,
          customer: 'cus_TWIN_x',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
          items: {
            data: [
              {
                id: tenant!.stripeSubscriptionItemId ?? 'si_TWIN_x',
                price: { id: 'price_pro_twin' },
              },
            ],
          },
        },
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayload(WEBHOOK_SECRET, ts, payload);

    const first = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': sig },
      payload,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': sig },
      payload,
    });
    expect(second.statusCode).toBe(200);
    const replayBody = second.json() as { deduped?: boolean };
    expect(replayBody.deduped).toBe(true);

    const count = await db.global.tenantPlanChange.count({
      where: { tenantId: t.tenantId, toPlan: 'pro' },
    });
    expect(count).toBe(1);
  });
});
