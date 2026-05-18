import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  db,
  isUniqueViolation,
  WebhookProcessingStatus,
  WebhookSource,
} from '@mygroomtime/db';
import { gcalPullJobId } from '../../queue/queue-names.js';

const CHANNEL_ID_HEADER = 'x-goog-channel-id';
const CHANNEL_TOKEN_HEADER = 'x-goog-channel-token';
const RESOURCE_STATE_HEADER = 'x-goog-resource-state';
const MESSAGE_NUMBER_HEADER = 'x-goog-message-number';

function readHeader(req: FastifyRequest, key: string): string | null {
  const v = req.headers[key];
  if (Array.isArray(v)) return v[0] ?? null;
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

// why: chunk-20 inbound from Google. We DON'T sign-by-HMAC here — Google verifies the
// channel by issuing it to a registered webhook URL + token. We trust the token we set
// at watch-channel-create time. Dedup uses MessageSid-style WebhookEvent on
// X-Goog-Message-Number prefixed by channelId so retries from Google don't double-pull.
export default async function gcalWebhookRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/webhooks/google-calendar',
    { config: { rateLimit: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const channelId = readHeader(request, CHANNEL_ID_HEADER);
      const channelToken = readHeader(request, CHANNEL_TOKEN_HEADER);
      const resourceState = readHeader(request, RESOURCE_STATE_HEADER);
      const messageNumber = readHeader(request, MESSAGE_NUMBER_HEADER) ?? '0';

      if (!channelId) {
        reply.code(400).send({ error: 'missing_channel_id' });
        return;
      }

      const link = await db.global.googleCalendarLink.findUnique({
        where: { watchChannelId: channelId },
      });
      if (!link) {
        // why: stale channel — already-disconnected user. Return 200 so Google stops retrying.
        reply.code(200).send({ ok: true, ignored: 'unknown_channel' });
        return;
      }
      if (link.watchChannelToken && link.watchChannelToken !== channelToken) {
        request.log.warn({ channelId }, 'gcal-webhook: channel token mismatch — rejecting');
        reply.code(401).send({ error: 'invalid_channel_token' });
        return;
      }

      // why: defense-in-depth — channels survive past user role changes. Resolve the
      // user → tenant and confirm the user still belongs there. Ops links are write-only
      // per chunk-21 spec; if we ever receive an ops notification it means a stale watch
      // channel — ignore safely so Google stops retrying.
      if (link.linkKind === 'tenant_operations') {
        reply.code(200).send({ ok: true, ignored: 'ops_link_write_only' });
        return;
      }
      if (!link.userId) {
        reply.code(200).send({ ok: true, ignored: 'orphan_link' });
        return;
      }
      const user = await db
        .forTenant(link.tenantId)
        .user.findFirst({ where: { id: link.userId } });
      if (!user) {
        request.log.warn(
          { channelId, userId: link.userId, tenantId: link.tenantId },
          'gcal-webhook: linked user no longer in tenant — rejecting',
        );
        reply.code(401).send({ error: 'stale_channel' });
        return;
      }

      if (resourceState === 'sync') {
        // why: Google fires a 'sync' notification right after watch creation as a smoke
        // test. No content to pull; 200 + done.
        reply.code(200).send({ ok: true, sync: true });
        return;
      }

      const eventKey = `${channelId}.${messageNumber}`;
      try {
        await db.global.webhookEvent.create({
          data: {
            source: WebhookSource.google_calendar,
            eventId: eventKey,
            payload: {
              channelId,
              resourceState,
              messageNumber,
              linkId: link.id,
            },
            status: WebhookProcessingStatus.processed,
            processedAt: new Date(),
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          reply.code(200).send({ deduped: true });
          return;
        }
        throw err;
      }

      if (app.gcalPullQueue) {
        await app.gcalPullQueue.add(
          'gcal-pull.delta',
          { linkId: link.id },
          {
            jobId: gcalPullJobId(link.id, messageNumber),
            attempts: 5,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 1000,
            removeOnFail: 500,
          },
        );
      }

      reply.code(200).send({ ok: true, enqueued: !!app.gcalPullQueue });
    },
  );
}
