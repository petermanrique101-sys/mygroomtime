import type { FastifyInstance } from 'fastify';
import { db, PlanTier } from '@mygroomtime/db';

export type TestTenant = { cookie: string; tenantId: string };

export async function cleanupTestTenants(prefix: string): Promise<void> {
  const tenants = await db.global.tenant.findMany({
    where: { slug: { startsWith: prefix } },
    select: { id: true },
  });
  for (const t of tenants) {
    await db.global.tenant.delete({ where: { id: t.id } });
  }
}

export async function signup(
  app: FastifyInstance,
  prefix: string,
  emailLocal: string,
  bizSuffix: string,
): Promise<TestTenant> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: {
      email: `${emailLocal}@example.test`,
      password: 'a-strong-password',
      businessName: `${prefix}${bizSuffix}`,
    },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  const cookie = cookieStr.split(';')[0]!;
  const body = res.json() as { tenant: { id: string } };
  // why: signup creates plan=unpaid (chunk 10). Test tenants here exercise post-billing
  // routes (clients/services/appointments), so promote to starter immediately.
  await db.global.tenant.update({
    where: { id: body.tenant.id },
    data: { plan: PlanTier.starter },
  });
  return { cookie, tenantId: body.tenant.id };
}

export const validClientPayload = (name = 'Sample Owner'): {
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  pets: { name: string; breed: string; weightLb: number; coatType: 'short' }[];
} => ({
  name,
  phone: '+19725550199',
  email: 'sample@example.test',
  street: '1234 Oak St',
  city: 'Plano',
  state: 'TX',
  zip: '75024',
  notes: '',
  pets: [{ name: 'Rex', breed: 'Labrador', weightLb: 70, coatType: 'short' }],
});

export const validServicePayload = (
  overrides: Partial<{ name: string; basePriceCents: number; durationMin: number }> = {},
): {
  name: string;
  durationMin: number;
  basePriceCents: number;
  depositCents: number;
  color: string;
  active: boolean;
} => ({
  name: overrides.name ?? 'Full Groom',
  durationMin: overrides.durationMin ?? 90,
  basePriceCents: overrides.basePriceCents ?? 8500,
  depositCents: 2000,
  color: '#2563eb',
  active: true,
});

export async function createClientAndPet(
  app: FastifyInstance,
  tenant: TestTenant,
): Promise<{ clientId: string; petId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/clients',
    headers: { cookie: tenant.cookie },
    payload: validClientPayload(),
  });
  const body = res.json() as { client: { id: string; pets: { id: string }[] } };
  return { clientId: body.client.id, petId: body.client.pets[0]!.id };
}

export async function createServiceFor(
  app: FastifyInstance,
  tenant: TestTenant,
  payload = validServicePayload(),
): Promise<{
  id: string;
  name: string;
  basePriceCents: number;
  durationMin: number;
  depositCents: number;
  color: string;
}> {
  const res = await app.inject({
    method: 'POST',
    url: '/services',
    headers: { cookie: tenant.cookie },
    payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`service create failed: ${res.statusCode} ${res.body}`);
  }
  return (
    res.json() as {
      service: {
        id: string;
        name: string;
        basePriceCents: number;
        durationMin: number;
        depositCents: number;
        color: string;
      };
    }
  ).service;
}

export function nextWeekdayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
