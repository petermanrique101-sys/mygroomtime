import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { ServiceInputSchema, type ServiceMutationResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { serializeService } from './serialize.js';

export default async function createServiceRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/services',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = ServiceInputSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid service details.',
          issues: parsed.error.issues,
        });
        return;
      }
      const input = parsed.data;
      const scoped = db.forTenant(auth.tenant.id);

      const created = await scoped.service.create({
        data: {
          name: input.name,
          durationMin: input.durationMin,
          basePriceCents: input.basePriceCents,
          depositCents: input.depositCents,
          color: input.color,
          active: input.active,
        },
      });
      const body: ServiceMutationResponse = { service: serializeService(created) };
      reply.code(201).send(body);
    },
  );
}
