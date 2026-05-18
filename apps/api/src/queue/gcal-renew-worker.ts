import type { Job } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { randomUUID, randomBytes } from 'node:crypto';
import { db } from '@mygroomtime/db';
import type { GcalAdapter } from '../adapters/gcal/index.js';
import { getAccessToken } from '../services/gcal-token-cache.js';
import type { GcalRenewHandler } from './gcal-connection.js';
import type { GcalRenewJobData, GcalRenewJobName } from './queue-names.js';

export type GcalRenewDeps = {
  gcal: GcalAdapter;
  redis: Redis | null;
  encryptionKey: string;
  webhookUrl: string;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
};

const RENEW_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_FAILS_BEFORE_REAUTH = 3;

export function createGcalRenewHandler(deps: GcalRenewDeps): GcalRenewHandler {
  return async function handle(
    _job: Job<GcalRenewJobData, void, GcalRenewJobName>,
  ): Promise<void> {
    const now = Date.now();
    const cutoff = new Date(now + RENEW_WINDOW_MS);
    const due = await db.global.googleCalendarLink.findMany({
      where: {
        needsReauth: false,
        OR: [
          { watchExpirationAt: null },
          { watchExpirationAt: { lte: cutoff } },
        ],
      },
    });
    for (const link of due) {
      await renewOne(deps, link);
    }
    deps.log.info({ candidates: due.length }, 'gcal-renew: walk completed');
  };
}

type LinkRow = Awaited<ReturnType<typeof db.global.googleCalendarLink.findMany>>[number];

async function renewOne(deps: GcalRenewDeps, link: LinkRow): Promise<void> {
  try {
    if (link.watchChannelId && link.watchResourceId) {
      const token = await getAccessToken(
        { redis: deps.redis, gcal: deps.gcal, encryptionKey: deps.encryptionKey },
        {
          userId: link.userId ?? `tenant-ops:${link.tenantId}`,
          encryptedRefreshToken: link.encryptedRefreshToken,
        },
      );
      await deps.gcal
        .stopChannel({
          accessToken: token.accessToken,
          channelId: link.watchChannelId,
          resourceId: link.watchResourceId,
        })
        .catch(() => undefined);
    }

    const token = await getAccessToken(
      { redis: deps.redis, gcal: deps.gcal, encryptionKey: deps.encryptionKey },
      {
          userId: link.userId ?? `tenant-ops:${link.tenantId}`,
          encryptedRefreshToken: link.encryptedRefreshToken,
        },
    );

    const channelId = randomUUID();
    const channelToken = randomBytes(24).toString('base64url');
    const channel = await deps.gcal.watchChannel({
      accessToken: token.accessToken,
      calendarId: link.googleCalendarId,
      webhookUrl: deps.webhookUrl,
      channelId,
      channelToken,
    });

    await db.global.googleCalendarLink.update({
      where: { id: link.id },
      data: {
        watchChannelId: channel.channelId,
        watchResourceId: channel.resourceId,
        watchChannelToken: channelToken,
        watchExpirationAt: new Date(channel.expirationMs),
        consecutiveRenewFailures: 0,
      },
    });
    deps.log.info(
      { linkId: link.id, channelId: channel.channelId, expirationMs: channel.expirationMs },
      'gcal-renew: refreshed watch channel',
    );
  } catch (err) {
    const fails = link.consecutiveRenewFailures + 1;
    const flagReauth = fails >= MAX_FAILS_BEFORE_REAUTH;
    await db.global.googleCalendarLink.update({
      where: { id: link.id },
      data: {
        consecutiveRenewFailures: fails,
        needsReauth: flagReauth ? true : link.needsReauth,
      },
    });
    deps.log.warn(
      { linkId: link.id, fails, flagReauth, err: (err as Error).message },
      'gcal-renew: failed to renew watch channel',
    );
  }
}
