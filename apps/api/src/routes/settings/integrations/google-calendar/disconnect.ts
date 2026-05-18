import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { requireAuth } from '../../../../middleware/require-auth.js';
import { requirePaidPlan } from '../../../../middleware/require-paid-plan.js';
import { decryptToken } from '../../../../services/token-encrypt.js';
import {
  getAccessToken,
  invalidateAccessToken,
} from '../../../../services/gcal-token-cache.js';

export default async function gcalDisconnectRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/settings/integrations/google-calendar/disconnect',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const link = await db
        .forTenant(auth.tenant.id)
        .googleCalendarLink.findFirst({ where: { userId: auth.user.id } });
      if (!link) {
        reply.send({ ok: true, alreadyDisconnected: true });
        return;
      }

      const env = app.appEnv;

      // why: best-effort revoke + stop. Wrapped because the user disconnecting must
      // succeed even if Google is unreachable. The row + watch are wiped regardless.
      try {
        if (link.watchChannelId && link.watchResourceId) {
          const token = await getAccessToken(
            {
              redis: app.gcalRedis ?? null,
              gcal: app.adapters.gcal,
              encryptionKey: env.gcal.tokenEncryptionKey,
            },
            { userId: link.userId, encryptedRefreshToken: link.encryptedRefreshToken },
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
          'gcal-disconnect: stop-channel failed (continuing)',
        );
      }

      try {
        const refresh = decryptToken(link.encryptedRefreshToken, env.gcal.tokenEncryptionKey);
        await app.adapters.gcal.revokeRefreshToken({ refreshToken: refresh });
      } catch (err) {
        request.log.warn(
          { err: (err as Error).message },
          'gcal-disconnect: revoke failed (continuing)',
        );
      }

      await invalidateAccessToken(app.gcalRedis ?? null, link.userId);

      await db
        .forTenant(auth.tenant.id)
        .googleCalendarLink.delete({ where: { id: link.id } });

      reply.send({ ok: true });
    },
  );
}
