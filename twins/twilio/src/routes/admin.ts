import type { FastifyInstance } from 'fastify';
import type { TwinState } from '../state.js';

export function registerAdmin(app: FastifyInstance, state: TwinState): void {
  app.post('/__twin_reset', async (_req, reply) => {
    state.reset();
    return reply.code(200).send({ ok: true });
  });
}
