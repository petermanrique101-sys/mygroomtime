import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { db, PlanTier } from '@mygroomtime/db';

export type PublicTenant = {
  id: string;
  slug: string;
  businessName: string;
  plan: PlanTier;
  phone: string | null;
  depotLat: number | null;
  depotLng: number | null;
  defaultBufferMinutes: number;
};

declare module 'fastify' {
  interface FastifyRequest {
    publicTenant?: PublicTenant;
    publicTenantReadOnly?: boolean;
  }
}

const NOT_FOUND = { error: 'not_found', message: 'Booking page not found.' };

export const resolvePublicTenant: preHandlerAsyncHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const params = request.params as { slug?: string };
  const slug = (params.slug ?? '').trim().toLowerCase();
  if (!slug) {
    reply.code(404).send(NOT_FOUND);
    return;
  }

  const tenant = await db.global.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      businessName: true,
      phone: true,
      plan: true,
      depotLat: true,
      depotLng: true,
      defaultBufferMinutes: true,
      stripeConnectChargesEnabled: true,
    },
  });

  if (!tenant) {
    reply.code(404).send(NOT_FOUND);
    return;
  }

  // why: booking page is a Pro+ feature. starter, unpaid, and canceled all 404 — the page
  // simply does not exist for those tiers (vs. 403, which would leak existence).
  if (tenant.plan !== PlanTier.pro && tenant.plan !== PlanTier.business && tenant.plan !== PlanTier.past_due) {
    reply.code(404).send(NOT_FOUND);
    return;
  }

  request.publicTenant = {
    id: tenant.id,
    slug: tenant.slug,
    businessName: tenant.businessName,
    plan: tenant.plan,
    phone: tenant.phone,
    depotLat: tenant.depotLat,
    depotLng: tenant.depotLng,
    defaultBufferMinutes: tenant.defaultBufferMinutes,
  };
  // why: read-only when payments are paused (past_due) OR Connect isn't fully onboarded
  // yet. Both states should render services with a disabled Book button + "contact the
  // groomer directly" copy (chunk 12 reuses chunk 11's past_due render path).
  request.publicTenantReadOnly =
    tenant.plan === PlanTier.past_due || !tenant.stripeConnectChargesEnabled;
};
