import type { FastifyInstance } from 'fastify';
import { db, PlanTier } from '@mygroomtime/db';
import type { TwinAppHandle } from '@mygroomtime/twin-google-calendar';
import { encryptToken } from '../../services/token-encrypt.js';
import { signup } from '../../routes/appointments/test-helpers.js';
import { buildTwinAuthorizeUrl } from './twin.js';

export const SLUG_PREFIX = 'gcal-e2e-test-';

export type Seed = {
  tenantId: string;
  userId: string;
  appointmentId: string;
  clientId: string;
};

export async function authorize(args: {
  app: FastifyInstance;
  twinUrl: string;
}): Promise<{ refresh: string; access: string }> {
  const auth = buildTwinAuthorizeUrl({
    twinUrl: args.twinUrl,
    redirectUri: 'http://localhost:3000/cb',
    state: 's',
  });
  const r = await fetch(auth, { redirect: 'manual' });
  const code = new URL(r.headers.get('location')!).searchParams.get('code')!;
  const tokens = await args.app.adapters.gcal.exchangeOAuthCode({
    code,
    redirectUri: 'http://localhost:3000/cb',
  });
  return { refresh: tokens.refreshToken, access: tokens.accessToken };
}

export async function seedProTenantWithLink(args: {
  app: FastifyInstance;
  twinUrl: string;
  twinHandle: TwinAppHandle;
  scenarioPrefix: string;
}): Promise<Seed> {
  const ts = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const tenant = await signup(
    args.app,
    SLUG_PREFIX,
    `${args.scenarioPrefix}-${ts}`,
    `${args.scenarioPrefix}-${ts}`,
  );
  await db.global.tenant.update({
    where: { id: tenant.tenantId },
    data: { plan: PlanTier.pro, businessName: 'Plano Pup Spa' },
  });

  const user = await db.forTenant(tenant.tenantId).user.findFirst({ where: {} });
  if (!user) throw new Error('no user after signup');

  const env = args.app.appEnv;
  const tok = await authorize({ app: args.app, twinUrl: args.twinUrl });
  await db.global.googleCalendarLink.create({
    data: {
      tenantId: tenant.tenantId,
      userId: user.id,
      googleUserId: 'twin-user-1',
      googleEmail: 'twin-user-1@mygroomtime.test',
      googleCalendarId: 'primary',
      encryptedRefreshToken: encryptToken(tok.refresh, env.gcal.tokenEncryptionKey),
    },
  });

  const scoped = db.forTenant(tenant.tenantId);
  const client = await scoped.client.create({
    data: {
      name: 'Carlos Rivera',
      phone: '+19725550199',
      addressStreet: '1 A St',
      addressCity: 'Plano',
      addressState: 'TX',
      addressZip: '75024',
    },
  });
  const pet = await scoped.pet.create({
    data: { clientId: client.id, name: 'Bruno', breed: 'Lab', coatType: 'short' },
  });
  const service = await scoped.service.create({
    data: { name: 'Full Groom', durationMin: 90, basePriceCents: 8500, depositCents: 2000 },
  });
  const vehicle = await scoped.vehicle.create({ data: { name: 'Van 1' } });
  const appt = await scoped.appointment.create({
    data: {
      clientId: client.id,
      petId: pet.id,
      serviceId: service.id,
      vehicleId: vehicle.id,
      groomerId: user.id,
      scheduledStart: new Date('2026-07-01T15:00:00.000Z'),
      durationMin: 90,
      serviceNameSnapshot: service.name,
      servicePriceCentsSnapshot: service.basePriceCents,
      serviceDepositCentsSnapshot: service.depositCents,
      serviceColorSnapshot: service.color,
      serviceDurationMinSnapshot: service.durationMin,
    },
  });
  return {
    tenantId: tenant.tenantId,
    userId: user.id,
    appointmentId: appt.id,
    clientId: client.id,
  };
}

export function fakePushJob(
  name: 'gcal-push.create' | 'gcal-push.update' | 'gcal-push.delete',
  appointmentId: string,
  tenantId: string,
): never {
  return {
    id: `${name}.${appointmentId}`,
    name,
    data: { appointmentId, tenantId },
  } as never;
}

export function fakePullJob(linkId: string): never {
  return {
    id: `gcal-pull.${linkId}.0`,
    name: 'gcal-pull.delta',
    data: { linkId },
  } as never;
}
