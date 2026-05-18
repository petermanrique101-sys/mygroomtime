import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { ServiceUpdateSchema, type ServiceMutationResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { findAnyService } from './find.js';
import { serializeService } from './serialize.js';

type Params = { id: string };

export default async function updateServiceRoute(app: FastifyInstance): Promise<void> {
  app.patch(
    '/services/:id',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'service' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const parsed = ServiceUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid update.',
          issues: parsed.error.issues,
        });
        return;
      }
      const input = parsed.data;
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await findAnyService(scoped, id);
      if (!existing || existing.deletedAt !== null) {
        reply.code(404).send({ error: 'service_not_found', message: 'Service not found.' });
        return;
      }

      const nextDeposit = input.depositCents ?? existing.depositCents;
      const nextPrice = input.basePriceCents ?? existing.basePriceCents;
      if (nextDeposit > nextPrice) {
        reply.code(400).send({
          error: 'invalid_request',
          message: 'Deposit cannot exceed the base price.',
          issues: [
            {
              code: 'custom',
              message: 'Deposit cannot exceed the base price.',
              path: ['depositCents'],
            },
          ],
        });
        return;
      }

      const updated = await scoped.service.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
          ...(input.basePriceCents !== undefined ? { basePriceCents: input.basePriceCents } : {}),
          ...(input.depositCents !== undefined ? { depositCents: input.depositCents } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      const body: ServiceMutationResponse = { service: serializeService(updated) };
      reply.send(body);
    },
  );
}
