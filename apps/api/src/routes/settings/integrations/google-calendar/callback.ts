import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '@mygroomtime/db';
import { verifyState } from '../../../../services/gcal-oauth-state.js';
import { encryptToken } from '../../../../services/token-encrypt.js';

const CALLBACK_PATH = '/settings/integrations/google-calendar/callback';

type Query = { code?: string; state?: string; error?: string };

export default async function gcalCallbackRoute(app: FastifyInstance): Promise<void> {
  app.get(
    CALLBACK_PATH,
    async (request: FastifyRequest<{ Querystring: Query }>, reply: FastifyReply) => {
      const env = app.appEnv;
      const webOrigin = env.webOrigin;

      if (request.query.error) {
        return redirectToSettings(reply, webOrigin, 'denied');
      }
      const code = request.query.code;
      const stateRaw = request.query.state;
      if (!code || !stateRaw) {
        return redirectToSettings(reply, webOrigin, 'invalid_request');
      }

      const state = verifyState({ state: stateRaw, secret: env.cookieSecret });
      if (!state) {
        return redirectToSettings(reply, webOrigin, 'invalid_state');
      }

      // why: state binds the OAuth flow to the original logged-in user. We re-check that
      // the user still belongs to the same tenant; a session swap mid-flow would otherwise
      // let user A's link be created under user B's session.
      const user = await db
        .forTenant(state.tenantId)
        .user.findFirst({ where: { id: state.userId } });
      if (!user) {
        return redirectToSettings(reply, webOrigin, 'session_changed');
      }

      try {
        const tokens = await app.adapters.gcal.exchangeOAuthCode({
          code,
          redirectUri: env.gcal.oauthRedirectUri,
        });
        const encrypted = encryptToken(tokens.refreshToken, env.gcal.tokenEncryptionKey);

        await db.global.googleCalendarLink.upsert({
          where: { userId: user.id },
          create: {
            tenantId: state.tenantId,
            userId: user.id,
            googleUserId: tokens.googleUserId,
            googleEmail: tokens.googleEmail,
            encryptedRefreshToken: encrypted,
            googleCalendarId: 'primary',
          },
          update: {
            googleUserId: tokens.googleUserId,
            googleEmail: tokens.googleEmail,
            encryptedRefreshToken: encrypted,
            needsReauth: false,
            consecutiveRenewFailures: 0,
          },
        });

        await registerWatchChannel(app, {
          tenantId: state.tenantId,
          userId: user.id,
          accessToken: tokens.accessToken,
        });
      } catch (err) {
        request.log.error(
          { err: (err as Error).message, userId: user.id },
          'gcal-callback: token exchange or watch registration failed',
        );
        return redirectToSettings(reply, webOrigin, 'connect_failed');
      }

      return redirectToSettings(reply, webOrigin, 'connected');
    },
  );
}

async function registerWatchChannel(
  app: FastifyInstance,
  args: { tenantId: string; userId: string; accessToken: string },
): Promise<void> {
  const env = app.appEnv;
  const channelId = randomUUID();
  const channelToken = randomBytes(24).toString('base64url');
  const result = await app.adapters.gcal.watchChannel({
    accessToken: args.accessToken,
    calendarId: 'primary',
    webhookUrl: env.gcal.webhookUrl,
    channelId,
    channelToken,
  });
  await db.global.googleCalendarLink.update({
    where: { userId: args.userId },
    data: {
      watchChannelId: result.channelId,
      watchResourceId: result.resourceId,
      watchChannelToken: channelToken,
      watchExpirationAt: new Date(result.expirationMs),
    },
  });
}

function redirectToSettings(reply: FastifyReply, webOrigin: string, status: string): void {
  const url = new URL('/settings/integrations/google-calendar', webOrigin);
  url.searchParams.set('status', status);
  reply.redirect(url.toString(), 302);
}
