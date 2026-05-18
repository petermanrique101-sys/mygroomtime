import type { FastifyInstance } from 'fastify';
import { findGrantByAccessToken, readBearer } from '../auth.js';
import type { TwinState } from '../state.js';
import {
  applyEventPatch,
  buildEvent,
  fireWatchNotification,
  listEventsForCalendar,
  serializeEvent,
  type EventInputBody,
} from '../events.js';

type CalParams = { calId: string };
type EventParams = { calId: string; eventId: string };
type ListQuery = { syncToken?: string };

export function registerEvents(app: FastifyInstance, state: TwinState): void {
  app.get<{ Params: CalParams; Querystring: ListQuery }>(
    '/calendar/v3/calendars/:calId/events',
    async (req, reply) => {
      const grant = findGrantByAccessToken(state, readBearer(req.headers.authorization));
      if (!grant) return reply.code(401).send({ error: { code: 401, message: 'invalid_credentials' } });

      const calendarId = req.params.calId;
      let afterMs: number | null = null;
      const incoming = req.query.syncToken;
      if (incoming) {
        const snap = state.syncTokens.get(incoming);
        if (!snap || snap.calendarId !== calendarId) {
          return reply.code(410).send({
            error: { code: 410, message: 'Sync token is no longer valid, a full sync is required.' },
          });
        }
        afterMs = snap.issuedAtMs;
      }

      const items = listEventsForCalendar(state, calendarId, afterMs).map(serializeEvent);
      const nextToken = state.ids.next('sync');
      state.syncTokens.set(nextToken, {
        token: nextToken,
        calendarId,
        issuedAtMs: Date.now(),
      });
      return reply.send({ kind: 'calendar#events', items, nextSyncToken: nextToken });
    },
  );

  app.post<{ Params: CalParams; Body: EventInputBody }>(
    '/calendar/v3/calendars/:calId/events',
    async (req, reply) => {
      const grant = findGrantByAccessToken(state, readBearer(req.headers.authorization));
      if (!grant) return reply.code(401).send({ error: { code: 401, message: 'invalid_credentials' } });

      const calendarId = req.params.calId;
      const ev = buildEvent({ state, calendarId, body: req.body ?? {} });
      fireWatchNotification({ state, calendarId });
      return reply.code(200).send(serializeEvent(ev));
    },
  );

  app.patch<{ Params: EventParams; Body: EventInputBody }>(
    '/calendar/v3/calendars/:calId/events/:eventId',
    async (req, reply) => {
      const grant = findGrantByAccessToken(state, readBearer(req.headers.authorization));
      if (!grant) return reply.code(401).send({ error: { code: 401, message: 'invalid_credentials' } });

      const ev = state.events.get(req.params.eventId);
      if (!ev) return reply.code(404).send({ error: { code: 404, message: 'not_found' } });
      applyEventPatch(ev, req.body ?? {});
      fireWatchNotification({ state, calendarId: ev.calendarId });
      return reply.send(serializeEvent(ev));
    },
  );

  app.put<{ Params: EventParams; Body: EventInputBody }>(
    '/calendar/v3/calendars/:calId/events/:eventId',
    async (req, reply) => {
      const grant = findGrantByAccessToken(state, readBearer(req.headers.authorization));
      if (!grant) return reply.code(401).send({ error: { code: 401, message: 'invalid_credentials' } });

      const ev = state.events.get(req.params.eventId);
      if (!ev) return reply.code(404).send({ error: { code: 404, message: 'not_found' } });
      applyEventPatch(ev, req.body ?? {});
      fireWatchNotification({ state, calendarId: ev.calendarId });
      return reply.send(serializeEvent(ev));
    },
  );

  app.delete<{ Params: EventParams }>(
    '/calendar/v3/calendars/:calId/events/:eventId',
    async (req, reply) => {
      const grant = findGrantByAccessToken(state, readBearer(req.headers.authorization));
      if (!grant) return reply.code(401).send({ error: { code: 401, message: 'invalid_credentials' } });

      const ev = state.events.get(req.params.eventId);
      if (!ev) return reply.code(204).send();
      // why: Google represents a deletion as an event with status:cancelled in subsequent
      // list-with-syncToken responses. We mark it cancelled + bump updated so the next
      // delta pull sees it; we don't actually remove from the map.
      ev.status = 'cancelled';
      ev.updated = new Date().toISOString();
      fireWatchNotification({ state, calendarId: ev.calendarId });
      return reply.code(204).send();
    },
  );
}
