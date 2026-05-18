import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp, type TwinAppHandle } from '../app.js';

let handle: TwinAppHandle;
const SECRET = 'whsec_test';

beforeEach(async () => {
  handle = createApp({ logger: false, webhookUrl: null, webhookSecret: SECRET });
  await handle.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = handle.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('twin address missing');
  handle.setPublicOrigin(`http://127.0.0.1:${addr.port}`);
});

afterEach(async () => {
  await handle.app.close();
});

async function form(
  path: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await handle.app.inject({
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(body).toString(),
  });
  if (res.statusCode !== 200) throw new Error(`POST ${path} → ${res.statusCode} ${res.body}`);
  return res.json() as Record<string, unknown>;
}

function asString(v: unknown): string {
  if (typeof v !== 'string') throw new Error(`expected string, got ${typeof v}`);
  return v;
}
function asNumber(v: unknown): number {
  if (typeof v !== 'number') throw new Error(`expected number, got ${typeof v}`);
  return v;
}
function asArray(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error('expected array');
  return v;
}

async function bootSubscription(priceId: string): Promise<string> {
  const cust = await form('/v1/customers', { email: `${priceId}@biz.test` });
  const session = await form('/v1/checkout/sessions', {
    customer: asString(cust.id),
    'line_items[0][price]': priceId,
    success_url: 'http://example.test/ok',
    cancel_url: 'http://example.test/cancel',
  });
  const path = new URL(asString(session.url)).pathname;
  const auto = await handle.app.inject({ method: 'GET', url: path + '?auto=1' });
  if (auto.statusCode !== 302) throw new Error(`auto-complete failed: ${auto.statusCode}`);
  const url = auto.headers.location as string;
  const sessionId = path.split('/').pop()!;
  // why: the success_url has {CHECKOUT_SESSION_ID} expanded; we only need the sub id.
  // Re-read the session to discover it.
  const sessGet = await handle.app.inject({
    method: 'GET',
    url: `/v1/checkout/sessions/${sessionId}`,
  });
  const sessJson = sessGet.json() as { subscription: string };
  if (!sessJson.subscription) throw new Error('no subscription on session');
  expect(url).toBeTruthy();
  return sessJson.subscription;
}

describe('stripe twin — POST /v1/invoices/upcoming', () => {
  it('rejects when subscription is missing', async () => {
    const res = await handle.app.inject({
      method: 'POST',
      url: '/v1/invoices/upcoming',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
  });

  it('upgrade (starter → business): amount_due > 0, charge line positive, credit line negative', async () => {
    const subId = await bootSubscription('price_starter_twin');
    const res = await handle.app.inject({
      method: 'POST',
      url: '/v1/invoices/upcoming',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        subscription: subId,
        'subscription_items[0][id]': `si_TWIN_${subId}`,
        'subscription_items[0][price]': 'price_business_twin',
        subscription_proration_behavior: 'create_prorations',
      }).toString(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(asNumber(body.amount_due)).toBeGreaterThan(0);
    const lines = asArray((body.lines as { data: unknown }).data);
    const credit = lines.find(
      (l) => asNumber((l as { amount: number }).amount) < 0,
    ) as { amount: number; description: string };
    const charge = lines.find(
      (l) =>
        asNumber((l as { amount: number; proration?: boolean }).amount) > 0 &&
        (l as { proration?: boolean }).proration === true,
    ) as { amount: number; description: string };
    expect(credit.amount).toBeLessThan(0);
    expect(credit.description).toContain('Starter');
    expect(charge.amount).toBeGreaterThan(0);
    expect(charge.description).toContain('Business');
  });

  it('downgrade (business → starter): amount_due is 0, includes balance-applied line', async () => {
    const subId = await bootSubscription('price_business_twin');
    const res = await handle.app.inject({
      method: 'POST',
      url: '/v1/invoices/upcoming',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        subscription: subId,
        'subscription_items[0][id]': `si_TWIN_${subId}`,
        'subscription_items[0][price]': 'price_starter_twin',
        subscription_proration_behavior: 'create_prorations',
      }).toString(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(asNumber(body.amount_due)).toBe(0);
    const lines = asArray((body.lines as { data: unknown }).data);
    const balanceApplied = lines.find(
      (l) => (l as { description?: string }).description?.startsWith('Credit of '),
    );
    expect(balanceApplied).toBeTruthy();
  });
});

describe('stripe twin — POST /v1/subscriptions/:id tier swap', () => {
  it('updates priceId and fires customer.subscription.updated', async () => {
    const received: Record<string, unknown>[] = [];
    handle.cfg.url = null;

    const subId = await bootSubscription('price_starter_twin');

    // wire a fresh collector via webhook-config
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        try {
          received.push(JSON.parse(body) as Record<string, unknown>);
        } catch {
          // ignore
        }
        res.statusCode = 200;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('collector address missing');
    handle.cfg.url = `http://127.0.0.1:${addr.port}/hook`;

    const updated = await handle.app.inject({
      method: 'POST',
      url: `/v1/subscriptions/${subId}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        'items[0][id]': `si_TWIN_${subId}`,
        'items[0][price]': 'price_pro_twin',
        proration_behavior: 'create_prorations',
      }).toString(),
    });
    expect(updated.statusCode).toBe(200);
    const upd = updated.json() as { items: { data: Array<{ price: { id: string } }> } };
    expect(upd.items.data[0]!.price.id).toBe('price_pro_twin');

    const deadline = Date.now() + 1000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(received.length).toBeGreaterThan(0);
    const evt = received[0]!;
    expect(evt.type).toBe('customer.subscription.updated');
    const data = (evt.data as { object: { items: { data: Array<{ price: { id: string } }> } } })
      .object;
    expect(data.items.data[0]!.price.id).toBe('price_pro_twin');

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
