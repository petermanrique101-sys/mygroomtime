import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { createApp, type TwinAppHandle } from './app.js';
import { verifyInboundWebhook } from './sign.js';

type Received = {
  headers: Record<string, string>;
  body: string;
  params: Record<string, string>;
};

async function collector(received: Received[]): Promise<{ url: string; close: () => Promise<void> }> {
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
      const params: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(body)) params[k] = v;
      received.push({ headers: hdrs, body, params });
      res.statusCode = 200;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  const url = `http://127.0.0.1:${address.port}/webhooks/twilio`;
  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

const AUTH = 'auth_test_twin';
const FROM = '+15555550100';
const ACCOUNT_SID = 'AC_test_twin';

let handle: TwinAppHandle;
let received: Received[];
let webhook: { url: string; close: () => Promise<void> };

beforeEach(async () => {
  received = [];
  webhook = await collector(received);
  handle = createApp({
    logger: false,
    authToken: AUTH,
    fromNumber: FROM,
    inboundWebhookUrl: webhook.url,
  });
});

afterEach(async () => {
  await handle.app.close();
  await webhook.close();
});

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`expected object, got ${typeof v}`);
  }
  return v as JsonObj;
}
function asString(v: unknown): string {
  if (typeof v !== 'string') throw new Error(`expected string, got ${typeof v}`);
  return v;
}

async function sendSms(body: Record<string, string>): Promise<{ status: number; json: JsonObj }> {
  const res = await handle.app.inject({
    method: 'POST',
    url: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(body).toString(),
  });
  return { status: res.statusCode, json: asObj(res.json()) };
}

describe('twilio twin — Messages.json', () => {
  it('happy path: accepts a send, returns a SID and an account_sid', async () => {
    const res = await sendSms({
      From: FROM,
      To: '+15551110000',
      Body: 'Hello there. Reply STOP to opt out.',
    });
    expect(res.status).toBe(201);
    expect(asString(res.json.sid)).toMatch(/^SM_TWIN_/);
    expect(res.json.account_sid).toBe(ACCOUNT_SID);
    expect(res.json.status).toBe('queued');
    expect(res.json.direction).toBe('outbound-api');
  });

  it('rejects 21606 when From does not match the configured number', async () => {
    const res = await sendSms({
      From: '+18005550000',
      To: '+15551110000',
      Body: 'Hi',
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe(21606);
  });

  it('rejects 21604 when required fields are missing', async () => {
    const res = await sendSms({ From: FROM, To: '+15551110000', Body: '' });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe(21604);
  });

  it('returns the same SID for a duplicate send within the 60s window', async () => {
    const a = await sendSms({ From: FROM, To: '+15551110000', Body: 'Hi twin' });
    const b = await sendSms({ From: FROM, To: '+15551110000', Body: 'Hi twin' });
    expect(a.json.sid).toBe(b.json.sid);
    const log = await handle.app.inject({ method: 'GET', url: '/__twin_messages' });
    const messages = asObj(log.json()).messages as unknown[];
    expect(messages).toHaveLength(1);
  });

  it('logs sent messages to /__twin_messages', async () => {
    await sendSms({ From: FROM, To: '+15551110000', Body: 'one' });
    await sendSms({ From: FROM, To: '+15551110001', Body: 'two' });
    const log = await handle.app.inject({ method: 'GET', url: '/__twin_messages' });
    const messages = asObj(log.json()).messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.body)).toEqual(['one', 'two']);
  });
});

describe('twilio twin — inbound simulation', () => {
  it('/__twin_inbound posts a properly-signed Twilio-shaped POST to the configured URL', async () => {
    const res = await handle.app.inject({
      method: 'POST',
      url: '/__twin_inbound',
      headers: { 'content-type': 'application/json' },
      payload: { from: '+15551112222', body: 'STOP' },
    });
    expect(res.statusCode).toBe(200);
    expect(received).toHaveLength(1);
    const r = received[0]!;
    expect(r.params.From).toBe('+15551112222');
    expect(r.params.Body).toBe('STOP');
    expect(r.params.To).toBe(FROM);
    expect(r.params.MessageSid).toMatch(/^SM_TWIN_IN_/);
    const sig = r.headers['x-twilio-signature']!;
    expect(verifyInboundWebhook(AUTH, webhook.url, r.params, sig)).toBe(true);
  });

  it('rejects /__twin_inbound when no URL is configured and none is overridden', async () => {
    handle.setInboundWebhookUrl(null);
    const res = await handle.app.inject({
      method: 'POST',
      url: '/__twin_inbound',
      headers: { 'content-type': 'application/json' },
      payload: { from: '+15551112222', body: 'STOP' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a per-call url override', async () => {
    handle.setInboundWebhookUrl(null);
    const res = await handle.app.inject({
      method: 'POST',
      url: '/__twin_inbound',
      headers: { 'content-type': 'application/json' },
      payload: { from: '+15551112222', body: 'START', url: webhook.url },
    });
    expect(res.statusCode).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]!.params.Body).toBe('START');
  });
});

describe('twilio twin — reset', () => {
  it('/__twin_reset clears state', async () => {
    await sendSms({ From: FROM, To: '+15551110000', Body: 'hi' });
    await handle.app.inject({ method: 'POST', url: '/__twin_reset' });
    const log = await handle.app.inject({ method: 'GET', url: '/__twin_messages' });
    expect((asObj(log.json()).messages as unknown[])).toHaveLength(0);
  });
});
