import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { makeTestEnv } from '../../test-utils/env.js';

const TEST_SLUG_PREFIX = 'services-test-';

type TestTenant = {
  cookie: string;
  tenantId: string;
};

async function cleanupTestTenants(): Promise<void> {
  const tenants = await db.global.tenant.findMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
    select: { id: true },
  });
  for (const t of tenants) {
    await db.global.tenant.delete({ where: { id: t.id } });
  }
}

async function signup(
  app: FastifyInstance,
  emailLocal: string,
  bizSuffix: string,
): Promise<TestTenant> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: {
      email: `${emailLocal}@example.test`,
      password: 'a-strong-password',
      businessName: `${TEST_SLUG_PREFIX}${bizSuffix}`,
    },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  const cookie = cookieStr.split(';')[0]!;
  const body = res.json() as { tenant: { id: string } };
  // why: chunk 10 made plan=unpaid the signup default. Promote to starter for tests
  // that exercise paid-plan-gated routes.
  await db.global.tenant.update({
    where: { id: body.tenant.id },
    data: { plan: PlanTier.starter },
  });
  return { cookie, tenantId: body.tenant.id };
}

const validServicePayload = (overrides: Partial<{ name: string }> = {}) => ({
  name: overrides.name ?? 'Test Groom',
  durationMin: 60,
  basePriceCents: 8500,
  depositCents: 2000,
  color: '#2563eb',
  active: true,
});

describe('services routes', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let geocodeTwinUrl: string;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const port = (geocodeTwin.server.address() as { port: number }).port;
    geocodeTwinUrl = `http://127.0.0.1:${port}`;

    const env = makeTestEnv();
    app = await createApp({
      logger: false,
      env,
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
      adapters: {
        geocode: createGeocodeAdapter({ mode: 'twin', apiKey: '', twinUrl: geocodeTwinUrl }),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenants();
    await app.close();
    await geocodeTwin.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants();
    const ts = Date.now();
    tenantA = await signup(app, `svcA-${ts}`, `tenantA-${ts}`);
    tenantB = await signup(app, `svcB-${ts}`, `tenantB-${ts}`);
  });

  it('POST /services creates a service; GET /services returns it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { cookie: tenantA.cookie },
      payload: validServicePayload({ name: 'Mobile Full Groom' }),
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as { service: { id: string; name: string; color: string } };
    expect(createdBody.service.name).toBe('Mobile Full Groom');
    expect(createdBody.service.color).toBe('#2563eb');

    const list = await app.inject({
      method: 'GET',
      url: '/services',
      headers: { cookie: tenantA.cookie },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { services: { name: string }[] };
    const names = listBody.services.map((s) => s.name);
    expect(names).toContain('Mobile Full Groom');
  });

  it('GET /services excludes soft-deleted by default; includeDeleted=true returns them', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { cookie: tenantA.cookie },
      payload: validServicePayload({ name: 'To Be Deleted' }),
    });
    const id = (created.json() as { service: { id: string } }).service.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/services/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(del.statusCode).toBe(204);

    const defaultList = await app.inject({
      method: 'GET',
      url: '/services',
      headers: { cookie: tenantA.cookie },
    });
    const defaultNames = (defaultList.json() as { services: { name: string }[] }).services.map(
      (s) => s.name,
    );
    expect(defaultNames).not.toContain('To Be Deleted');

    const withDeleted = await app.inject({
      method: 'GET',
      url: '/services?includeDeleted=true',
      headers: { cookie: tenantA.cookie },
    });
    const withDeletedBody = withDeleted.json() as {
      services: { name: string; deletedAt: string | null }[];
    };
    const deletedEntry = withDeletedBody.services.find((s) => s.name === 'To Be Deleted');
    expect(deletedEntry).toBeDefined();
    expect(deletedEntry!.deletedAt).not.toBeNull();
  });

  it('POST /services with depositCents > basePriceCents returns 400 with field error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { cookie: tenantA.cookie },
      payload: {
        ...validServicePayload(),
        basePriceCents: 5000,
        depositCents: 6000,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; message: string; issues?: { path: string[] }[] };
    expect(body.error).toBe('invalid_request');
    expect(body.message).toMatch(/Deposit/i);
    expect(body.issues?.some((i) => i.path.includes('depositCents'))).toBe(true);
  });

  it('PATCH /services with depositCents > existing basePriceCents returns 400', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { cookie: tenantA.cookie },
      payload: validServicePayload({ name: 'Patch Test' }),
    });
    const id = (created.json() as { service: { id: string } }).service.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/services/${id}`,
      headers: { cookie: tenantA.cookie },
      payload: { depositCents: 9999999 },
    });
    expect(patched.statusCode).toBe(400);
  });

  it('GET /services from tenant A does not see tenant B services (tenant isolation)', async () => {
    await app.inject({
      method: 'POST',
      url: '/services',
      headers: { cookie: tenantA.cookie },
      payload: validServicePayload({ name: 'A-only Service' }),
    });
    await app.inject({
      method: 'POST',
      url: '/services',
      headers: { cookie: tenantB.cookie },
      payload: validServicePayload({ name: 'B-only Service' }),
    });

    const listA = await app.inject({
      method: 'GET',
      url: '/services',
      headers: { cookie: tenantA.cookie },
    });
    const namesA = (listA.json() as { services: { name: string }[] }).services.map((s) => s.name);
    expect(namesA).toContain('A-only Service');
    expect(namesA).not.toContain('B-only Service');

    const listB = await app.inject({
      method: 'GET',
      url: '/services',
      headers: { cookie: tenantB.cookie },
    });
    const namesB = (listB.json() as { services: { name: string }[] }).services.map((s) => s.name);
    expect(namesB).toContain('B-only Service');
    expect(namesB).not.toContain('A-only Service');
  });

  it('POST /services/:id/restore brings a soft-deleted service back', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/services',
      headers: { cookie: tenantA.cookie },
      payload: validServicePayload({ name: 'Restorable' }),
    });
    const id = (created.json() as { service: { id: string } }).service.id;

    await app.inject({
      method: 'DELETE',
      url: `/services/${id}`,
      headers: { cookie: tenantA.cookie },
    });

    const restored = await app.inject({
      method: 'POST',
      url: `/services/${id}/restore`,
      headers: { cookie: tenantA.cookie },
    });
    expect(restored.statusCode).toBe(200);
    const body = restored.json() as { service: { deletedAt: string | null } };
    expect(body.service.deletedAt).toBeNull();
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/services',
    });
    expect(res.statusCode).toBe(401);
  });
});
