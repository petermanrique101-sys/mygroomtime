import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { createApp, type TwinAppHandle } from './app.js';
import { verifySignature } from './signature.js';

type Received = { headers: Record<string, string>; body: string; parsed: unknown };

async function collector(received: Received[]): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const hdrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') hdrs[k] = v;
        else if (Array.isArray(v)) hdrs[k] = v.join(',');
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
      received.push({ headers: hdrs, body, parsed });
      res.statusCode = 200;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  const url = `http://127.0.0.1:${address.port}/hook`;
  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

let handle: TwinAppHandle;
let received: Received[];
let webhook: { url: string; close: () => Promise<void> };

const SECRET = 'whsec_test';

beforeEach(async () => {
  received = [];
  webhook = await collector(received);
  handle = createApp({ logger: false, webhookUrl: webhook.url, webhookSecret: SECRET });
  await handle.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = handle.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('twin address missing');
  handle.setPublicOrigin(`http://127.0.0.1:${addr.port}`);
});

afterEach(async () => {
  await handle.app.close();
  await webhook.close();
});

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`expected json object, got ${typeof v}`);
  }
  return v as JsonObj;
}
function asString(v: unknown): string {
  if (typeof v !== 'string') throw new Error(`expected string, got ${typeof v}`);
  return v;
}
function eventType(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const t = (parsed as { type?: unknown }).type;
  return typeof t === 'string' ? t : null;
}

type FormResult = { status: number; json: JsonObj };

async function form(path: string, body: Record<string, string>): Promise<FormResult> {
  const res = await handle.app.inject({
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(body).toString(),
  });
  return { status: res.statusCode, json: asObj(res.json()) };
}

async function waitForEvents(min: number, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (received.length < min && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('stripe twin — customers and checkout auto-complete', () => {
  it('creates a customer with metadata', async () => {
    const res = await form('/v1/customers', {
      email: 'a@b.test',
      'metadata[tenantId]': 'tenant_abc',
    });
    expect(res.status).toBe(200);
    expect(asString(res.json.id)).toMatch(/^cus_TWIN_/);
    expect(res.json.email).toBe('a@b.test');
    expect(asObj(res.json.metadata).tenantId).toBe('tenant_abc');
  });

  it('checkout session ?auto=1 completes and fires checkout.session.completed', async () => {
    const cust = await form('/v1/customers', { email: 'c@b.test' });
    const customerId = asString(cust.json.id);
    const session = await form('/v1/checkout/sessions', {
      customer: customerId,
      'line_items[0][price]': 'price_starter_twin',
      success_url: 'http://example.test/ok?session={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://example.test/cancel',
      'metadata[tenantId]': 'tenant_abc',
      'metadata[tier]': 'starter',
    });
    expect(session.status).toBe(200);
    const url = asString(session.json.url);

    const auto = await handle.app.inject({ method: 'GET', url: new URL(url).pathname + '?auto=1' });
    expect(auto.statusCode).toBe(302);
    expect(auto.headers.location).toContain(asString(session.json.id));

    await waitForEvents(2);
    const types = received.map((r) => eventType(r.parsed));
    expect(types).toContain('checkout.session.completed');
    expect(types).toContain('customer.subscription.created');

    const completed = received.find((r) => eventType(r.parsed) === 'checkout.session.completed');
    expect(completed).toBeTruthy();
    const sig = completed!.headers['stripe-signature']!;
    expect(verifySignature(SECRET, sig, completed!.body)).toBe(true);
  });

  it('checkout hosted page renders HTML with a Pay button', async () => {
    const cust = await form('/v1/customers', { email: 'c2@b.test' });
    const session = await form('/v1/checkout/sessions', {
      customer: asString(cust.json.id),
      'line_items[0][price]': 'price_pro_twin',
      success_url: 'http://example.test/ok',
      cancel_url: 'http://example.test/cancel',
    });
    const pathname = new URL(asString(session.json.url)).pathname;
    const page = await handle.app.inject({ method: 'GET', url: pathname });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('<form');
    expect(page.body).toContain('Pay');
  });
});

describe('stripe twin — payment intent test card outcomes', () => {
  async function createPi(): Promise<string> {
    const acct = await form('/v1/accounts', { email: 'x@y.test', country: 'US' });
    const pi = await form('/v1/payment_intents', {
      amount: '4000',
      currency: 'usd',
      on_behalf_of: asString(acct.json.id),
    });
    return asString(pi.json.id);
  }

  it('tok_visa_ok confirms to succeeded and fires payment_intent.succeeded', async () => {
    const id = await createPi();
    const res = await form(`/v1/payment_intents/${id}/confirm`, { payment_method: 'tok_visa_ok' });
    expect(res.json.status).toBe('succeeded');
    await waitForEvents(1);
    expect(received.some((r) => eventType(r.parsed) === 'payment_intent.succeeded')).toBe(true);
  });

  it('tok_visa_decline → requires_payment_method with card_declined', async () => {
    const id = await createPi();
    const res = await form(`/v1/payment_intents/${id}/confirm`, {
      payment_method: 'tok_visa_decline',
    });
    expect(res.json.status).toBe('requires_payment_method');
    expect(asObj(res.json.last_payment_error).code).toBe('card_declined');
  });

  it('tok_visa_insuf → requires_payment_method with insufficient_funds', async () => {
    const id = await createPi();
    const res = await form(`/v1/payment_intents/${id}/confirm`, {
      payment_method: 'tok_visa_insuf',
    });
    expect(res.json.status).toBe('requires_payment_method');
    expect(asObj(res.json.last_payment_error).code).toBe('insufficient_funds');
  });

  it('tok_visa_3ds → requires_action', async () => {
    const id = await createPi();
    const res = await form(`/v1/payment_intents/${id}/confirm`, {
      payment_method: 'tok_visa_3ds',
    });
    expect(res.json.status).toBe('requires_action');
  });
});

describe('stripe twin — subscription transitions + replay', () => {
  async function bootCustomerAndSub(): Promise<{ customerId: string; subId: string }> {
    const cust = await form('/v1/customers', { email: 's@b.test' });
    const customerId = asString(cust.json.id);
    const session = await form('/v1/checkout/sessions', {
      customer: customerId,
      'line_items[0][price]': 'price_business_twin',
      success_url: 'http://example.test/ok',
      cancel_url: 'http://example.test/cancel',
      'metadata[tenantId]': 'tenant_z',
    });
    const auto = await handle.app.inject({
      method: 'GET',
      url: new URL(asString(session.json.url)).pathname + '?auto=1',
    });
    expect(auto.statusCode).toBe(302);
    await waitForEvents(2);
    const subEvt = received.find(
      (r) => eventType(r.parsed) === 'customer.subscription.created',
    )!;
    const data = asObj(asObj(JSON.parse(subEvt.body)).data);
    const subId = asString(asObj(data.object).id);
    return { customerId, subId };
  }

  it('simulate invoice.payment_failed → past_due → deleted', async () => {
    const { subId } = await bootCustomerAndSub();
    received.length = 0;

    const pf = await handle.app.inject({
      method: 'POST',
      url: '/__twin__/simulate-event',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'invoice.payment_failed', subscription_id: subId },
    });
    expect(pf.statusCode).toBe(200);

    const upd = await handle.app.inject({
      method: 'POST',
      url: '/__twin__/simulate-event',
      headers: { 'content-type': 'application/json' },
      payload: {
        type: 'customer.subscription.updated',
        subscription_id: subId,
        status: 'past_due',
      },
    });
    expect(upd.statusCode).toBe(200);

    const del = await handle.app.inject({
      method: 'POST',
      url: '/__twin__/simulate-event',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'customer.subscription.deleted', subscription_id: subId },
    });
    expect(del.statusCode).toBe(200);

    await waitForEvents(3);
    const types = received.map((r) => eventType(r.parsed));
    expect(types).toContain('invoice.payment_failed');
    expect(types).toContain('customer.subscription.updated');
    expect(types).toContain('customer.subscription.deleted');
  });

  it('replay-event re-delivers a past event with a valid signature', async () => {
    const { subId } = await bootCustomerAndSub();
    received.length = 0;

    const fired = await handle.app.inject({
      method: 'POST',
      url: '/__twin__/simulate-event',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'invoice.payment_failed', subscription_id: subId },
    });
    const firedBody = asObj(fired.json());
    const firedEventId = asString(firedBody.event_id);
    await waitForEvents(1);
    received.length = 0;

    const replay = await handle.app.inject({
      method: 'POST',
      url: '/__twin__/replay-event',
      headers: { 'content-type': 'application/json' },
      payload: { event_id: firedEventId },
    });
    expect(replay.statusCode).toBe(200);
    await waitForEvents(1);
    expect(received.length).toBe(1);
    const sig = received[0]!.headers['stripe-signature']!;
    expect(verifySignature(SECRET, sig, received[0]!.body)).toBe(true);
    const parsed = asObj(received[0]!.parsed);
    expect(parsed.id).toBe(firedEventId);
  });
});
