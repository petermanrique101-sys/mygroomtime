import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import type { FastifyInstance } from 'fastify';
import { makeTestEnv } from '../../test-utils/env.js';

const env = makeTestEnv();

const TEST_SLUG_PREFIX = 'auth-signup-test-';

async function cleanupTestTenants(): Promise<void> {
  const tenants = await db.global.tenant.findMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
    select: { id: true },
  });
  for (const t of tenants) {
    await db.global.tenant.delete({ where: { id: t.id } });
  }
}

describe('POST /auth/signup — happy path', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      logger: false,
      env,
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
    });
  });

  afterAll(async () => {
    await cleanupTestTenants();
    await app.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants();
  });

  it('creates a tenant + owner user, hashes password with argon2id, sets session cookie', async () => {
    const ts = Date.now();
    const businessName = `${TEST_SLUG_PREFIX}biz-${ts}`;
    const email = `owner-${ts}@example.test`;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email, password: 'a-strong-password', businessName },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { user: { email: string; role: string }; tenant: { slug: string; businessName: string } };
    expect(body.user.email).toBe(email);
    expect(body.user.role).toBe('owner');
    expect(body.tenant.businessName).toBe(businessName);
    expect(body.tenant.slug.startsWith(TEST_SLUG_PREFIX)).toBe(true);

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    expect(cookieStr).toContain('mgt_session=');
    expect(cookieStr).toContain('HttpOnly');
    expect(cookieStr).toContain('SameSite=Lax');

    const tenant = await db.global.tenant.findUnique({ where: { slug: body.tenant.slug } });
    expect(tenant).not.toBeNull();
    const users = await db.forTenant(tenant!.id).user.findMany();
    expect(users.length).toBe(1);
    expect(users[0]?.hashedPassword?.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects a weak password with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'short@example.test', password: 'short', businessName: 'Shortpw Biz' },
    });
    expect(res.statusCode).toBe(400);
  });
});
