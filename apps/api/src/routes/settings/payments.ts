import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import type {
  SettingsPaymentsStatus,
  SettingsPaymentsOnboardResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';

async function syncTenantFromStripe(
  app: FastifyInstance,
  tenantId: string,
  accountId: string,
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean }> {
  const acct = await app.adapters.stripe.getConnectAccount({ accountId });
  await db.global.tenant.update({
    where: { id: tenantId },
    data: {
      stripeConnectChargesEnabled: acct.chargesEnabled,
      stripeConnectPayoutsEnabled: acct.payoutsEnabled,
      stripeConnectStatusUpdatedAt: new Date(),
    },
  });
  return {
    chargesEnabled: acct.chargesEnabled,
    payoutsEnabled: acct.payoutsEnabled,
    detailsSubmitted: acct.detailsSubmitted,
  };
}

export default async function settingsPaymentsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/settings/payments',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const tenant = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: {
          stripeConnectAccountId: true,
          stripeConnectChargesEnabled: true,
          stripeConnectPayoutsEnabled: true,
          stripeConnectStatusUpdatedAt: true,
        },
      });
      if (!tenant) {
        reply.code(404).send({ error: 'tenant_not_found', message: 'Tenant not found.' });
        return;
      }

      if (!tenant.stripeConnectAccountId) {
        const body: SettingsPaymentsStatus = {
          connectAccountId: null,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          needsOnboarding: true,
          statusUpdatedAt: null,
        };
        reply.send(body);
        return;
      }

      // why: sync from Stripe on every GET so the owner sees fresh state. The
      // account.updated webhook does the same write, but this is the cheap
      // post-onboarding redirect path where it must reflect immediately.
      const live = await syncTenantFromStripe(
        app,
        auth.tenant.id,
        tenant.stripeConnectAccountId,
      );
      const body: SettingsPaymentsStatus = {
        connectAccountId: tenant.stripeConnectAccountId,
        chargesEnabled: live.chargesEnabled,
        payoutsEnabled: live.payoutsEnabled,
        detailsSubmitted: live.detailsSubmitted,
        needsOnboarding: !live.chargesEnabled,
        statusUpdatedAt: new Date().toISOString(),
      };
      reply.send(body);
    },
  );

  app.post(
    '/settings/payments/onboard',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const tenant = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: { id: true, stripeConnectAccountId: true },
      });
      if (!tenant) {
        reply.code(404).send({ error: 'tenant_not_found', message: 'Tenant not found.' });
        return;
      }

      let accountId = tenant.stripeConnectAccountId;
      if (!accountId) {
        // why: lazy-create on first onboard click — no point reserving acct ids during
        // signup before the owner is ready to take payments.
        const created = await app.adapters.stripe.createConnectAccount({
          email: auth.user.email,
          country: 'US',
        });
        accountId = created.id;
        await db.global.tenant.update({
          where: { id: tenant.id },
          data: { stripeConnectAccountId: accountId },
        });
      }

      const returnUrl = `${app.appEnv.webOrigin}/settings/payments`;
      const link = await app.adapters.stripe.createConnectAccountLink({
        accountId,
        refreshUrl: returnUrl,
        returnUrl,
      });
      const body: SettingsPaymentsOnboardResponse = { url: link.url };
      reply.send(body);
    },
  );
}
