import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, clearedCookieOptions } from '../../auth/cookie.js';

export default async function logoutRoute(app: FastifyInstance): Promise<void> {
  app.post('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        await app.sessionStore.destroy(unsigned.value);
      }
    }
    reply.clearCookie(SESSION_COOKIE, clearedCookieOptions(app.appEnv.nodeEnv === 'production'));
    reply.code(204).send();
  });
}
