import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, GoogleCalendarLinkKind } from '@mygroomtime/db';
import { requireAuth } from '../../../../middleware/require-auth.js';
import { requirePaidPlan } from '../../../../middleware/require-paid-plan.js';
import { requireBusinessTier } from '../../../../middleware/require-business-tier.js';
import { decryptToken } from '../../../../services/token-encrypt.js';
import {
  getAccessToken,
  invalidateAccessToken,
} from '../../../../services/gcal-token-cache.js';

export default async function gcalOpsDisconnectRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/settings/integrations/google-calendar/operations/disconnect',
    { preHandler: [requireAuth, requirePaidPlan, requireBusinessTier] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const link = await db
        .forTenant(auth.tenant.id)
        .googleCalendarLink.findFirst({
          where: { linkKind: GoogleCalendarLinkKind.tenant_operations },
        });
      if (!link) {
        reply.send({ ok: true, alreadyDisconnected: true });
        return;
      }

      const env = app.appEnv;
      const tokenSubject = `tenant-ops:${auth.tenant.id}`;

      // why: ops links don't carry a watch channel (write-only per spec), but a future
      // migration could add one — keep the stop step here defensively.
      try {
        if (link.watchChannelId && link.watchResourceId) {
          const token = await getAccessToken(
            {
              redis: app.gcalRedis ?? null,
              gcal: app.adapters.gcal,
              encryptionKey: env.gcal.tokenEncryptionKey,
            },
            { userId: tokenSubject, encryptedRefreshToken: link.encryptedRefreshToken },
          );
          await app.adapters.gcal.stopChannel({
            accessToken: token.accessToken,
            channelId: link.watchChannelId,
            resourceId: link.watchResourceId,
          });
        }
      } catch (err) {
        request.log.warn(
          { err: (err as Error).message },
          'gcal-ops-disconnect: stop-channel failed (continuing)',
        );
      }

      try {
        const refresh = decryptToken(link.encryptedRefreshToken, env.gcal.tokenEncryptionKey);
        await app.adapters.gcal.revokeRefreshToken({ refreshToken: refresh });
      } catch (err) {
        request.log.warn(
          { err: (err as Error).message },
          'gcal-ops-disconnect: revoke failed (continuing)',
        );
      }

      await invalidateAccessToken(app.gcalRedis ?? null, tokenSubject);

      await db
        .forTenant(auth.tenant.id)
        .googleCalendarLink.delete({ where: { id: link.id } });

      reply.send({ ok: true });
    },
  );
}
