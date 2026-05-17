import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

type Role = 'owner' | 'groomer' | 'dispatcher';

export function requireRole(role: Role | Role[]): preHandlerAsyncHookHandler {
  const allowed = Array.isArray(role) ? role : [role];
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.auth) {
      reply.code(401).send({ error: 'auth_required', message: 'Sign in to continue.' });
      return;
    }
    if (!allowed.includes(request.auth.user.role)) {
      reply.code(403).send({
        error: 'forbidden',
        message: `Requires role: ${allowed.join(' or ')}.`,
      });
      return;
    }
  };
}
