import type { FastifyInstance } from 'fastify';
import type { TwinState } from '../state.js';
import {
  buildEvent,
  fireWatchNotification,
  serializeEvent,
  type EventInputBody,
} from '../events.js';

type ExternalCreateBody = EventInputBody & { calendarId?: string };

export function registerAdmin(app: FastifyInstance, state: TwinState): void {
  // why: tests use this to simulate "user clicked New Event in their Google Calendar UI".
  // Triggers a watch notification (the real path) and stores the event so the next delta
  // pull surfaces it. Callers can pass an mgtAppointmentId in extendedProperties.private
  // to simulate an EXTERNAL EDIT to an already-pushed appointment.
  app.post<{ Body: ExternalCreateBody }>(
    '/__twin__/external-event-created',
    async (req, reply) => {
      const body = req.body ?? {};
      const calendarId = body.calendarId ?? 'primary';
      const ev = buildEvent({ state, calendarId, body });
      fireWatchNotification({ state, calendarId });
      return reply.send({ event: serializeEvent(ev) });
    },
  );

  app.post<{ Body: { eventId: string; patch: EventInputBody } }>(
    '/__twin__/external-event-patched',
    async (req, reply) => {
      const ev = state.events.get(req.body?.eventId ?? '');
      if (!ev) return reply.code(404).send({ error: 'not_found' });
      const patch = req.body?.patch ?? {};
      if (patch.summary !== undefined) ev.summary = patch.summary;
      if (patch.description !== undefined) ev.description = patch.description;
      if (patch.start?.dateTime) ev.startIso = patch.start.dateTime;
      if (patch.end?.dateTime) ev.endIso = patch.end.dateTime;
      if (patch.status === 'cancelled' || patch.status === 'confirmed') ev.status = patch.status;
      ev.updated = new Date().toISOString();
      fireWatchNotification({ state, calendarId: ev.calendarId });
      return reply.send({ event: serializeEvent(ev) });
    },
  );

  app.post<{ Body: { eventId: string } }>(
    '/__twin__/external-event-deleted',
    async (req, reply) => {
      const ev = state.events.get(req.body?.eventId ?? '');
      if (!ev) return reply.code(404).send({ error: 'not_found' });
      ev.status = 'cancelled';
      ev.updated = new Date().toISOString();
      fireWatchNotification({ state, calendarId: ev.calendarId });
      return reply.code(204).send();
    },
  );

  app.get('/__twin_events', async () => {
    return { events: Array.from(state.events.values()).map(serializeEvent) };
  });

  app.get('/__twin_deliveries', async () => {
    return { deliveries: state.deliveries };
  });

  app.get('/__twin_watch_channels', async () => {
    return { channels: Array.from(state.watchChannels.values()) };
  });

  app.post('/__twin_reset', async (_req, reply) => {
    state.reset();
    return reply.code(200).send({ ok: true });
  });
}
