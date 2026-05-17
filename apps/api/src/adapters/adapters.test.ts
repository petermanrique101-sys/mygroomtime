import { describe, it, expect } from 'vitest';
import { createAdapters } from './index.js';
import { createApp } from '../app.js';
import { createMemorySessionStore } from './session/index.js';
import { createStdoutEmailAdapter } from './email/index.js';
import { makeTestEnv } from '../test-utils/env.js';

describe('createAdapters — mode selection', () => {
  it('returns twin instances when each <SERVICE>_MODE is twin', () => {
    const env = makeTestEnv({
      stripeMode: 'twin',
      twilioMode: 'twin',
      gcalMode: 'twin',
      gmapsMode: 'twin',
      geocodeMode: 'twin',
    });
    const a = createAdapters(env, {
      session: createMemorySessionStore(),
      email: createStdoutEmailAdapter(),
    });
    expect(a.stripe.mode).toBe('twin');
    expect(a.twilio.mode).toBe('twin');
    expect(a.gcal.mode).toBe('twin');
    expect(a.gmaps.mode).toBe('twin');
    expect(a.geocode.mode).toBe('twin');
  });

  it('returns live instances when each <SERVICE>_MODE is live', () => {
    const env = makeTestEnv({
      stripeMode: 'live',
      twilioMode: 'live',
      gcalMode: 'live',
      gmapsMode: 'live',
      geocodeMode: 'live',
    });
    const a = createAdapters(env, {
      session: createMemorySessionStore(),
      email: createStdoutEmailAdapter(),
    });
    expect(a.stripe.mode).toBe('live');
    expect(a.twilio.mode).toBe('live');
    expect(a.gcal.mode).toBe('live');
    expect(a.gmaps.mode).toBe('live');
    expect(a.geocode.mode).toBe('live');
  });

  it('mixes modes per service independently', () => {
    const env = makeTestEnv({
      stripeMode: 'twin',
      twilioMode: 'live',
      gcalMode: 'twin',
      gmapsMode: 'live',
      geocodeMode: 'twin',
    });
    const a = createAdapters(env, {
      session: createMemorySessionStore(),
      email: createStdoutEmailAdapter(),
    });
    expect(a.stripe.mode).toBe('twin');
    expect(a.twilio.mode).toBe('live');
    expect(a.gcal.mode).toBe('twin');
    expect(a.gmaps.mode).toBe('live');
    expect(a.geocode.mode).toBe('twin');
  });
});

describe('GET /probe/adapters', () => {
  it('reports the wired mode of each adapter', async () => {
    const app = await createApp({
      logger: false,
      env: makeTestEnv({
        stripeMode: 'twin',
        twilioMode: 'live',
        gcalMode: 'twin',
        gmapsMode: 'live',
      }),
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
    });

    const res = await app.inject({ method: 'GET', url: '/probe/adapters' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      stripeMode: 'twin',
      twilioMode: 'live',
      gcalMode: 'twin',
      gmapsMode: 'live',
      geocodeMode: 'twin',
    });

    await app.close();
  });
});
