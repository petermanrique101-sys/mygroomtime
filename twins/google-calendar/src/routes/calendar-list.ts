import type { FastifyInstance } from 'fastify';
import type { TwinState } from '../state.js';
import { findGrantByAccessToken, readBearer } from '../auth.js';

export function registerCalendarList(app: FastifyInstance, state: TwinState): void {
  app.get('/calendar/v3/users/me/calendarList', async (req, reply) => {
    const grant = findGrantByAccessToken(state, readBearer(req.headers.authorization));
    if (!grant) return reply.code(401).send({ error: { code: 401, message: 'Invalid Credentials' } });
    return reply.send({
      kind: 'calendar#calendarList',
      items: [
        {
          id: 'primary',
          summary: grant.email,
          primary: true,
          accessRole: 'owner',
        },
      ],
    });
  });
}
