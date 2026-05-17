import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import { createMemorySessionStore } from './adapters/session/index.js';
import { createStdoutEmailAdapter } from './adapters/email/index.js';
import { makeTestEnv } from './test-utils/env.js';

describe('GET /healthz', () => {
  it('returns 200 with status ok', async () => {
    const app = await createApp({
      logger: false,
      env: makeTestEnv(),
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });

    await app.close();
  });
});
