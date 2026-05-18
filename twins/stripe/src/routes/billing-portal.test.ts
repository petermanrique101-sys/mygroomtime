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
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await handle.app.inject({
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(body).toString(),
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

function asString(v: unknown): string {
  if (typeof v !== 'string') throw new Error(`expected string, got ${typeof v}`);
  return v;
}

describe('stripe twin — billing portal sessions', () => {
  it('rejects when customer is missing', async () => {
    const res = await form('/v1/billing_portal/sessions', { return_url: 'http://x.test' });
    expect(res.status).toBe(400);
  });

  it('creates a session pointing at the twin-hosted portal page', async () => {
    const cust = await form('/v1/customers', { email: 'portal@biz.test' });
    const customerId = asString(cust.json.id);
    const res = await form('/v1/billing_portal/sessions', {
      customer: customerId,
      return_url: 'http://example.test/settings/billing',
    });
    expect(res.status).toBe(200);
    expect(res.json.object).toBe('billing_portal.session');
    const url = asString(res.json.url);
    expect(url).toContain('/__twin_billing_portal/');
    expect(url).toContain(encodeURIComponent('http://example.test/settings/billing'));

    const pageRes = await handle.app.inject({ method: 'GET', url: new URL(url).pathname + new URL(url).search });
    expect(pageRes.statusCode).toBe(200);
    expect(pageRes.headers['content-type']).toContain('text/html');
    expect(pageRes.body).toContain('Back to app');
  });

  it('?auto=1 redirects to return_url', async () => {
    const cust = await form('/v1/customers', { email: 'portal2@biz.test' });
    const session = await form('/v1/billing_portal/sessions', {
      customer: asString(cust.json.id),
      return_url: 'http://example.test/settings/billing',
    });
    const url = asString(session.json.url);
    const parsed = new URL(url);
    parsed.searchParams.set('auto', '1');
    const res = await handle.app.inject({
      method: 'GET',
      url: parsed.pathname + parsed.search,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://example.test/settings/billing');
  });
});
