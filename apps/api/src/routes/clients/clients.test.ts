import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp, lookupZip } from '@mygroomtime/twin-geocode';
import { db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { makeTestEnv } from '../../test-utils/env.js';

const TEST_SLUG_PREFIX = 'clients-test-';

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
  // why: chunk 10 made plan=unpaid the signup default. Promote here so the existing
  // clients/services/appointments tests still hit the protected routes.
  await db.global.tenant.update({
    where: { id: body.tenant.id },
    data: { plan: PlanTier.starter },
  });
  return { cookie, tenantId: body.tenant.id };
}

const validClientPayload = (overrides: Partial<{ name: string; address: string }> = {}) => ({
  name: overrides.name ?? 'Alex Rivera',
  phone: '+19725550199',
  email: 'alex@example.test',
  street: overrides.address ?? '1234 Oak St',
  city: 'Plano',
  state: 'TX',
  zip: '75024',
  notes: '',
  pets: [
    {
      name: 'Rex',
      breed: 'Labrador',
      weightLb: 70,
      coatType: 'short',
    },
  ],
});

describe('clients + pets routes', () => {
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
    tenantA = await signup(app, `ownerA-${ts}`, `tenantA-${ts}`);
    tenantB = await signup(app, `ownerB-${ts}`, `tenantB-${ts}`);
  });

  it('POST /clients with a valid Plano address geocodes inline and sets addressVerified=true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { cookie: tenantA.cookie },
      payload: validClientPayload(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      client: { id: string; lat: number; lng: number; addressVerified: boolean; pets: { name: string }[] };
      warning: unknown;
    };
    expect(body.warning).toBeFalsy();
    expect(body.client.addressVerified).toBe(true);
    const centroid = lookupZip('75024')!;
    expect(Math.abs(body.client.lat - centroid.lat)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(Math.abs(body.client.lng - centroid.lng)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(body.client.pets.length).toBe(1);
    expect(body.client.pets[0]!.name).toBe('Rex');
  });

  it('POST /clients with __ZERO_RESULTS__ saves the client unverified with a warning (no 4xx)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { cookie: tenantA.cookie },
      payload: validClientPayload({ address: '__ZERO_RESULTS__ House' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      client: { lat: number | null; lng: number | null; addressVerified: boolean };
      warning: { code: string; message: string } | null;
    };
    expect(body.client.addressVerified).toBe(false);
    expect(body.client.lat).toBeNull();
    expect(body.client.lng).toBeNull();
    expect(body.warning?.code).toBe('address_unverified');
  });

  it('GET /clients only returns clients in the requesting tenant (cross-tenant isolation)', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { cookie: tenantA.cookie },
      payload: validClientPayload({ name: 'Tenant A Client' }),
    });
    expect(a.statusCode).toBe(201);
    const b = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { cookie: tenantB.cookie },
      payload: validClientPayload({ name: 'Tenant B Client' }),
    });
    expect(b.statusCode).toBe(201);

    const listA = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { cookie: tenantA.cookie },
    });
    expect(listA.statusCode).toBe(200);
    const bodyA = listA.json() as { clients: { name: string }[] };
    expect(bodyA.clients.length).toBe(1);
    expect(bodyA.clients[0]!.name).toBe('Tenant A Client');

    const listB = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { cookie: tenantB.cookie },
    });
    const bodyB = listB.json() as { clients: { name: string }[] };
    expect(bodyB.clients.length).toBe(1);
    expect(bodyB.clients[0]!.name).toBe('Tenant B Client');
  });

  it('GET /clients/:id returns the client + its active pets', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { cookie: tenantA.cookie },
      payload: validClientPayload(),
    });
    const id = (created.json() as { client: { id: string } }).client.id;

    const fetched = await app.inject({
      method: 'GET',
      url: `/clients/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(fetched.statusCode).toBe(200);
    const body = fetched.json() as { client: { id: string; pets: { name: string }[] } };
    expect(body.client.id).toBe(id);
    expect(body.client.pets.length).toBe(1);
  });

  it('PATCH /clients/:id re-geocodes when the address changes', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { cookie: tenantA.cookie },
      payload: validClientPayload(),
    });
    const id = (created.json() as { client: { id: string } }).client.id;
    const before = (created.json() as { client: { lat: number; lng: number } }).client;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/clients/${id}`,
      headers: { cookie: tenantA.cookie },
      payload: { street: '9999 Different St', zip: '75093' },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json() as {
      client: { lat: number; lng: number; street: string; zip: string; addressVerified: boolean };
      warning: unknown;
    };
    expect(body.client.zip).toBe('75093');
    expect(body.client.addressVerified).toBe(true);
    const centroid = lookupZip('75093')!;
    expect(Math.abs(body.client.lat - centroid.lat)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(body.client.lat).not.toBe(before.lat);
  });

  it('DELETE /clients/:id soft-deletes — list excludes it, get returns 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { cookie: tenantA.cookie },
      payload: validClientPayload(),
    });
    const id = (created.json() as { client: { id: string } }).client.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/clients/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { cookie: tenantA.cookie },
    });
    expect((list.json() as { clients: unknown[] }).clients.length).toBe(0);

    const get = await app.inject({
      method: 'GET',
      url: `/clients/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(get.statusCode).toBe(404);

    // Soft delete: row still exists, deletedAt set, FK references would survive.
    const tenantId = tenantA.tenantId;
    const row = await db
      .forTenant(tenantId)
      .client.findFirst({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.deletedAt).not.toBeNull();
  });

  it('POST/PATCH/DELETE /clients/:id/pets — happy paths', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { cookie: tenantA.cookie },
      payload: validClientPayload(),
    });
    const id = (created.json() as { client: { id: string } }).client.id;

    const addPet = await app.inject({
      method: 'POST',
      url: `/clients/${id}/pets`,
      headers: { cookie: tenantA.cookie },
      payload: { name: 'Mochi', breed: 'Shiba', weightLb: 22, coatType: 'double' },
    });
    expect(addPet.statusCode).toBe(201);
    const petId = (addPet.json() as { pet: { id: string } }).pet.id;

    const patchPet = await app.inject({
      method: 'PATCH',
      url: `/clients/${id}/pets/${petId}`,
      headers: { cookie: tenantA.cookie },
      payload: { preferredCutStyle: 'puppy cut' },
    });
    expect(patchPet.statusCode).toBe(200);
    expect((patchPet.json() as { pet: { preferredCutStyle: string } }).pet.preferredCutStyle).toBe(
      'puppy cut',
    );

    const delPet = await app.inject({
      method: 'DELETE',
      url: `/clients/${id}/pets/${petId}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(delPet.statusCode).toBe(204);

    const fetched = await app.inject({
      method: 'GET',
      url: `/clients/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    const fetchedBody = fetched.json() as { client: { pets: { id: string }[] } };
    const remaining = fetchedBody.client.pets.map((p) => p.id);
    expect(remaining).not.toContain(petId);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clients',
    });
    expect(res.statusCode).toBe(401);
  });
});
