import type { FastifyInstance } from 'fastify';
import { findGrantByAccessToken, readBearer } from '../auth.js';
import type { TwinState, TwinWatchChannel } from '../state.js';

type WatchBody = {
  id?: string;
  type?: string;
  address?: string;
  token?: string;
  params?: { ttl?: string };
};

type CalParams = { calId: string };

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function registerWatch(app: FastifyInstance, state: TwinState): void {
  app.post<{ Params: CalParams; Body: WatchBody }>(
    '/calendar/v3/calendars/:calId/events/watch',
    async (req, reply) => {
      const grant = findGrantByAccessToken(state, readBearer(req.headers.authorization));
      if (!grant) return reply.code(401).send({ error: { code: 401, message: 'invalid_credentials' } });

      const body = req.body ?? {};
      const channelId = body.id ?? state.ids.next('chan');
      if (!body.address) {
        return reply.code(400).send({ error: { code: 400, message: 'missing_address' } });
      }
      const resourceId = state.ids.next('res');
      const ttlMs = parseTtlMs(body.params?.ttl) ?? DEFAULT_TTL_MS;
      const ch: TwinWatchChannel = {
        channelId,
        resourceId,
        calendarId: req.params.calId,
        accessToken: grant.accessToken,
        webhookUrl: body.address,
        token: body.token ?? null,
        expirationMs: Date.now() + ttlMs,
      };
      state.watchChannels.set(channelId, ch);
      return reply.send({
        kind: 'api#channel',
        id: channelId,
        resourceId,
        resourceUri: `https://www.googleapis.com/calendar/v3/calendars/${req.params.calId}/events`,
        expiration: String(ch.expirationMs),
      });
    },
  );

  app.post<{ Body: { id?: string; resourceId?: string } }>(
    '/calendar/v3/channels/stop',
    async (req, reply) => {
      const grant = findGrantByAccessToken(state, readBearer(req.headers.authorization));
      if (!grant) return reply.code(401).send({ error: { code: 401, message: 'invalid_credentials' } });

      const id = req.body?.id;
      if (id) state.watchChannels.delete(id);
      return reply.code(204).send();
    },
  );
}

function parseTtlMs(ttl: string | undefined): number | null {
  if (!ttl) return null;
  const n = Number(ttl);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * 1000;
}
