import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, GoogleCalendarLinkKind } from '@mygroomtime/db';
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
        return redirectToSettings(reply, webOrigin, 'user', 'denied');
      }
      const code = request.query.code;
      const stateRaw = request.query.state;
      if (!code || !stateRaw) {
        return redirectToSettings(reply, webOrigin, 'user', 'invalid_request');
      }

      const state = verifyState({ state: stateRaw, secret: env.cookieSecret });
      if (!state) {
        return redirectToSettings(reply, webOrigin, 'user', 'invalid_state');
      }

      const linkKind = state.linkKind ?? 'user';

      // why: state binds the OAuth flow to the original logged-in user. We re-check that
      // the user still belongs to the same tenant; a session swap mid-flow would otherwise
      // let user A's link be created under user B's session.
      const user = await db
        .forTenant(state.tenantId)
        .user.findFirst({ where: { id: state.userId } });
      if (!user) {
        return redirectToSettings(reply, webOrigin, linkKind, 'session_changed');
      }

      try {
        const tokens = await app.adapters.gcal.exchangeOAuthCode({
          code,
          redirectUri: env.gcal.oauthRedirectUri,
        });
        const encrypted = encryptToken(tokens.refreshToken, env.gcal.tokenEncryptionKey);

        const writtenLinkId = await upsertLink({
          tenantId: state.tenantId,
          userId: user.id,
          linkKind,
          tokens: {
            googleUserId: tokens.googleUserId,
            googleEmail: tokens.googleEmail,
            encryptedRefreshToken: encrypted,
          },
        });

        // why: ops calendar is write-only in v1 per spec. Skip the watch channel so we
        // don't enqueue pull jobs for events we don't ingest. User links still register
        // the channel for the two-way sync.
        if (linkKind === 'user') {
          await registerWatchChannel(app, {
            linkId: writtenLinkId,
            accessToken: tokens.accessToken,
          });
        }
      } catch (err) {
        request.log.error(
          { err: (err as Error).message, userId: user.id, linkKind },
          'gcal-callback: token exchange or watch registration failed',
        );
        return redirectToSettings(reply, webOrigin, linkKind, 'connect_failed');
      }

      return redirectToSettings(reply, webOrigin, linkKind, 'connected');
    },
  );
}

async function upsertLink(args: {
  tenantId: string;
  userId: string;
  linkKind: 'user' | 'tenant_operations';
  tokens: {
    googleUserId: string;
    googleEmail: string | null;
    encryptedRefreshToken: string;
  };
}): Promise<string> {
  // why: tenant_operations links live at the tenant level (userId is null), per the
  // chunk-21 schema. User links use the (userId, linkKind) composite unique.
  if (args.linkKind === 'tenant_operations') {
    const existing = await db.global.googleCalendarLink.findFirst({
      where: { tenantId: args.tenantId, linkKind: GoogleCalendarLinkKind.tenant_operations },
    });
    if (existing) {
      const updated = await db.global.googleCalendarLink.update({
        where: { id: existing.id },
        data: {
          googleUserId: args.tokens.googleUserId,
          googleEmail: args.tokens.googleEmail,
          encryptedRefreshToken: args.tokens.encryptedRefreshToken,
          needsReauth: false,
          consecutiveRenewFailures: 0,
        },
      });
      return updated.id;
    }
    const created = await db.global.googleCalendarLink.create({
      data: {
        tenantId: args.tenantId,
        userId: null,
        linkKind: GoogleCalendarLinkKind.tenant_operations,
        googleUserId: args.tokens.googleUserId,
        googleEmail: args.tokens.googleEmail,
        encryptedRefreshToken: args.tokens.encryptedRefreshToken,
        googleCalendarId: 'primary',
      },
    });
    return created.id;
  }

  const upserted = await db.global.googleCalendarLink.upsert({
    where: { userId_linkKind: { userId: args.userId, linkKind: GoogleCalendarLinkKind.user } },
    create: {
      tenantId: args.tenantId,
      userId: args.userId,
      linkKind: GoogleCalendarLinkKind.user,
      googleUserId: args.tokens.googleUserId,
      googleEmail: args.tokens.googleEmail,
      encryptedRefreshToken: args.tokens.encryptedRefreshToken,
      googleCalendarId: 'primary',
    },
    update: {
      googleUserId: args.tokens.googleUserId,
      googleEmail: args.tokens.googleEmail,
      encryptedRefreshToken: args.tokens.encryptedRefreshToken,
      needsReauth: false,
      consecutiveRenewFailures: 0,
    },
  });
  return upserted.id;
}

async function registerWatchChannel(
  app: FastifyInstance,
  args: { linkId: string; accessToken: string },
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
    where: { id: args.linkId },
    data: {
      watchChannelId: result.channelId,
      watchResourceId: result.resourceId,
      watchChannelToken: channelToken,
      watchExpirationAt: new Date(result.expirationMs),
    },
  });
}

function redirectToSettings(
  reply: FastifyReply,
  webOrigin: string,
  linkKind: 'user' | 'tenant_operations',
  status: string,
): void {
  const path =
    linkKind === 'tenant_operations'
      ? '/settings/integrations/google-calendar/operations'
      : '/settings/integrations/google-calendar';
  const url = new URL(path, webOrigin);
  url.searchParams.set('status', status);
  reply.redirect(url.toString(), 302);
}
