import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, type CoatType } from '@mygroomtime/db';
import { PetInputSchema } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { findActiveClient } from './find.js';
import { serializePet } from './serialize.js';

type Params = { id: string };

function toCoatType(value: string): CoatType {
  return value as CoatType;
}

export default async function createPetRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/clients/:id/pets',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'pet' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id: clientId } = request.params as Params;
      const parsed = PetInputSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid pet details.',
        });
        return;
      }
      const scoped = db.forTenant(auth.tenant.id);
      const client = await findActiveClient(scoped, clientId);
      if (!client) {
        reply.code(404).send({ error: 'client_not_found', message: 'Client not found.' });
        return;
      }
      const p = parsed.data;
      const created = await scoped.pet.create({
        data: {
          clientId: client.id,
          name: p.name,
          breed: p.breed,
          weightLb: p.weightLb ?? null,
          coatType: toCoatType(p.coatType),
          temperamentNotes: p.temperamentNotes ?? '',
          preferredCutStyle: p.preferredCutStyle ?? '',
          vaccinationExpiry: p.vaccinationExpiry ? new Date(p.vaccinationExpiry) : null,
          photoUrl: p.photoUrl ?? null,
        },
      });
      reply.code(201).send({ pet: serializePet(created) });
    },
  );
}
