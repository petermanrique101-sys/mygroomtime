import type { FastifyReply } from 'fastify';
import type { AuthSession, AuthUser, AuthTenant, PlanTier } from '@mygroomtime/shared';
import type { SessionStore } from '../adapters/session/index.js';
import { SESSION_COOKIE, sessionCookieOptions } from './cookie.js';

export type AppUserRow = {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'groomer' | 'dispatcher';
};

export type AppTenantRow = {
  id: string;
  slug: string;
  businessName: string;
  plan: PlanTier;
  stripeSubscriptionStatus?: string | null;
  currentPeriodEnd?: Date | null;
  pastDueAt?: Date | null;
};

export function toAuthUser(u: AppUserRow): AuthUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export function toAuthTenant(t: AppTenantRow): AuthTenant {
  return {
    id: t.id,
    slug: t.slug,
    businessName: t.businessName,
    plan: t.plan,
    stripeSubscriptionStatus: t.stripeSubscriptionStatus ?? null,
    currentPeriodEnd: t.currentPeriodEnd ? t.currentPeriodEnd.toISOString() : null,
    pastDueAt: t.pastDueAt ? t.pastDueAt.toISOString() : null,
  };
}

export async function issueSession(
  reply: FastifyReply,
  store: SessionStore,
  isProd: boolean,
  user: AppUserRow,
  tenant: AppTenantRow,
): Promise<AuthSession> {
  const sid = await store.create({ userId: user.id, tenantId: tenant.id });
  reply.setCookie(SESSION_COOKIE, sid, sessionCookieOptions(isProd));
  return { user: toAuthUser(user), tenant: toAuthTenant(tenant) };
}
