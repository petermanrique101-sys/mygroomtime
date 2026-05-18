import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createTwilioTwinApp, type TwinAppHandle } from '@mygroomtime/twin-twilio';
import { createHmac } from 'node:crypto';
import { db, SmsDirection } from '@mygroomtime/db';
import { createApp } from '../../../app.js';
import { createMemorySessionStore } from '../../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../../adapters/email/index.js';
import { createTwilioAdapter } from '../../../adapters/twilio/index.js';
import { makeTestEnv } from '../../../test-utils/env.js';
import { cleanupTestTenants, signup, type TestTenant } from '../../appointments/test-helpers.js';

const PREFIX = 'twilio-webhook-';
const FROM_CUSTOMER = '+19725550199';
const TWILIO_FROM = '+15555550100';
const AUTH = 'auth_test_webhook';

let app: FastifyInstance;
let twin: TwinAppHandle;
let twinUrl: string;
let tenant: TestTenant;

beforeAll(async () => {
  twin = createTwilioTwinApp({ logger: false, authToken: AUTH, fromNumber: TWILIO_FROM });
  await twin.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = twin.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('twin address missing');
  twinUrl = `http://127.0.0.1:${addr.port}`;

  const env = makeTestEnv();
  env.twilio.authToken = AUTH;
  env.twilio.fromNumber = TWILIO_FROM;
  env.twilio.twinUrl = twinUrl;
  app = await createApp({
    logger: false,
    env,
    sessionStore: createMemorySessionStore(),
    emailAdapter: createStdoutEmailAdapter(),
    adapters: {
      twilio: createTwilioAdapter({
        mode: 'twin',
        accountSid: 'AC_test',
        authToken: AUTH,
        fromNumber: TWILIO_FROM,
        twinUrl,
      }),
    },
  });
});

afterAll(async () => {
  await cleanupTestTenants(PREFIX);
  await app.close();
  await twin.app.close();
});

beforeEach(async () => {
  await cleanupTestTenants(PREFIX);
  await db.global.webhookEvent.deleteMany({
    where: { eventId: { startsWith: 'SM_WEBHOOK_TEST_' } },
  });
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  tenant = await signup(app, PREFIX, `wh-${ts}`, `wh-${ts}`);
  await db.forTenant(tenant.tenantId).client.create({
    data: {
      name: 'Test Customer',
      phone: FROM_CUSTOMER,
      addressStreet: '1 A St',
      addressCity: 'Plano',
      addressState: 'TX',
      addressZip: '75024',
    },
  });
});

function makeSig(url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  let base = url;
  for (const k of sortedKeys) base += k + params[k]!;
  return createHmac('sha1', AUTH).update(base).digest('base64');
}

async function postInbound(
  params: Record<string, string>,
  opts: { tamperSig?: boolean; tamperBodyAfterSign?: boolean } = {},
): Promise<Awaited<ReturnType<typeof app.inject>>> {
  const url = 'http://localhost/webhooks/twilio';
  const sig = makeSig(url, params);
  // why: flip a leading base64 char rather than appending — appending past the '='
  // padding is silently dropped by Buffer.from('base64'), so the tampered sig would
  // still verify.
  const finalSig = opts.tamperSig
    ? (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    : sig;
  const sendParams = opts.tamperBodyAfterSign ? { ...params, Body: `${params.Body}!!` } : params;
  return app.inject({
    method: 'POST',
    url: '/webhooks/twilio',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': finalSig,
      // why: the route reconstructs the URL from x-forwarded headers when present;
      // simulate that so the signed base matches.
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'localhost',
    },
    payload: new URLSearchParams(sendParams).toString(),
  });
}

describe('POST /webhooks/twilio — signature + dedupe', () => {
  it('rejects 400 when signature is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'From=%2B19725550199&Body=STOP&MessageSid=SM_WEBHOOK_TEST_a&To=%2B15555550100',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects 400 when signature is invalid', async () => {
    const res = await postInbound(
      { MessageSid: 'SM_WEBHOOK_TEST_b', From: FROM_CUSTOMER, To: TWILIO_FROM, Body: 'STOP' },
      { tamperSig: true },
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects 400 when body is tampered post-signing (the suffix would change)', async () => {
    const res = await postInbound(
      { MessageSid: 'SM_WEBHOOK_TEST_c', From: FROM_CUSTOMER, To: TWILIO_FROM, Body: 'STOP' },
      { tamperBodyAfterSign: true },
    );
    expect(res.statusCode).toBe(400);
  });

  it('deduplicates by MessageSid — replay returns 200 deduped:true', async () => {
    const params = {
      MessageSid: 'SM_WEBHOOK_TEST_replay',
      From: FROM_CUSTOMER,
      To: TWILIO_FROM,
      Body: 'STOP',
    };
    const first = await postInbound(params);
    expect(first.statusCode).toBe(200);
    const second = await postInbound(params);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { deduped?: boolean }).deduped).toBe(true);

    const rows = await db.forTenant(tenant.tenantId).smsMessage.findMany({
      where: { direction: SmsDirection.in },
    });
    expect(rows.length).toBe(1);
  });
});

describe('POST /webhooks/twilio — STOP/START', () => {
  it('STOP sets Client.smsOptOut=true + smsOptOutAt=now', async () => {
    const res = await postInbound({
      MessageSid: 'SM_WEBHOOK_TEST_stop',
      From: FROM_CUSTOMER,
      To: TWILIO_FROM,
      Body: 'STOP',
    });
    expect(res.statusCode).toBe(200);
    const c = await db.forTenant(tenant.tenantId).client.findFirst({
      where: { phone: FROM_CUSTOMER },
    });
    expect(c?.smsOptOut).toBe(true);
    expect(c?.smsOptOutAt).toBeInstanceOf(Date);
  });

  it('all canonical STOP keywords trigger opt-out', async () => {
    for (const word of ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) {
      await db.forTenant(tenant.tenantId).client.updateMany({
        where: { phone: FROM_CUSTOMER },
        data: { smsOptOut: false, smsOptOutAt: null },
      });
      const res = await postInbound({
        MessageSid: `SM_WEBHOOK_TEST_${word.toLowerCase()}`,
        From: FROM_CUSTOMER,
        To: TWILIO_FROM,
        Body: word,
      });
      expect(res.statusCode).toBe(200);
      const c = await db.forTenant(tenant.tenantId).client.findFirst({
        where: { phone: FROM_CUSTOMER },
      });
      expect(c?.smsOptOut, `STOP word: ${word}`).toBe(true);
    }
  });

  it('lower-case stop and whitespace-padded "  stop  " both opt out', async () => {
    const res = await postInbound({
      MessageSid: 'SM_WEBHOOK_TEST_lc',
      From: FROM_CUSTOMER,
      To: TWILIO_FROM,
      Body: '  stop  ',
    });
    expect(res.statusCode).toBe(200);
    const c = await db.forTenant(tenant.tenantId).client.findFirst({
      where: { phone: FROM_CUSTOMER },
    });
    expect(c?.smsOptOut).toBe(true);
  });

  it('START re-enables a previously opted-out client; multiple STOP/START cycles work', async () => {
    const fromOpt = (sid: string, body: string) =>
      postInbound({ MessageSid: sid, From: FROM_CUSTOMER, To: TWILIO_FROM, Body: body });

    await fromOpt('SM_WEBHOOK_TEST_c1_stop', 'STOP');
    await fromOpt('SM_WEBHOOK_TEST_c1_start', 'START');
    let c = await db.forTenant(tenant.tenantId).client.findFirst({
      where: { phone: FROM_CUSTOMER },
    });
    expect(c?.smsOptOut).toBe(false);
    expect(c?.smsOptOutAt).toBeNull();

    await fromOpt('SM_WEBHOOK_TEST_c2_stop', 'STOP');
    c = await db.forTenant(tenant.tenantId).client.findFirst({
      where: { phone: FROM_CUSTOMER },
    });
    expect(c?.smsOptOut).toBe(true);

    await fromOpt('SM_WEBHOOK_TEST_c2_unstop', 'UNSTOP');
    c = await db.forTenant(tenant.tenantId).client.findFirst({
      where: { phone: FROM_CUSTOMER },
    });
    expect(c?.smsOptOut).toBe(false);
  });

  it('non-STOP/START reply: opt-out flag unchanged, inbound row persisted', async () => {
    const res = await postInbound({
      MessageSid: 'SM_WEBHOOK_TEST_other',
      From: FROM_CUSTOMER,
      To: TWILIO_FROM,
      Body: 'Thanks!',
    });
    expect(res.statusCode).toBe(200);
    const c = await db.forTenant(tenant.tenantId).client.findFirst({
      where: { phone: FROM_CUSTOMER },
    });
    expect(c?.smsOptOut).toBe(false);
    const rows = await db.forTenant(tenant.tenantId).smsMessage.findMany({
      where: { direction: SmsDirection.in },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.body).toBe('Thanks!');
  });

  it('unmatched From: returns 200, no SmsMessage row written, no tenant scope needed', async () => {
    const res = await postInbound({
      MessageSid: 'SM_WEBHOOK_TEST_unknown',
      From: '+18005551234',
      To: TWILIO_FROM,
      Body: 'STOP',
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { matched?: boolean }).matched).toBe(false);
    const rows = await db.forTenant(tenant.tenantId).smsMessage.findMany({});
    expect(rows.length).toBe(0);
  });
});
