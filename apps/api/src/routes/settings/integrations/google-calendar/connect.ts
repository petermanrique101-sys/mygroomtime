import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../../../../middleware/require-auth.js';
import { requirePaidPlan } from '../../../../middleware/require-paid-plan.js';
import { requireProTier } from '../../../../middleware/require-pro-tier.js';
import { buildState } from '../../../../services/gcal-oauth-state.js';
import { buildLiveAuthorizeUrl } from '../../../../adapters/gcal/live.js';
import { buildTwinAuthorizeUrl } from '../../../../adapters/gcal/twin.js';

export default async function gcalConnectRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/settings/integrations/google-calendar/connect',
    { preHandler: [requireAuth, requirePaidPlan, requireProTier] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const env = app.appEnv;
      const state = buildState({
        userId: auth.user.id,
        tenantId: auth.tenant.id,
        secret: env.cookieSecret,
      });
      const redirectUri = env.gcal.oauthRedirectUri;
      const url =
        env.gcal.mode === 'live'
          ? buildLiveAuthorizeUrl({
              clientId: env.gcal.oauthClientId,
              redirectUri,
              state,
            })
          : buildTwinAuthorizeUrl({
              twinUrl: env.gcal.twinUrl,
              redirectUri,
              state,
            });
      reply.send({ url });
    },
  );
}
