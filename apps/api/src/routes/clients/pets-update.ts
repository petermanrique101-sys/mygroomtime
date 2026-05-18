import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, type CoatType } from '@mygroomtime/db';
import { PetUpdateSchema } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { findActiveClient, findActivePet } from './find.js';
import { serializePet } from './serialize.js';

type Params = { id: string; petId: string };

function toCoatType(value: string): CoatType {
  return value as CoatType;
}

export default async function updatePetRoute(app: FastifyInstance): Promise<void> {
  app.patch(
    '/clients/:id/pets/:petId',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'pet' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id: clientId, petId } = request.params as Params;
      const parsed = PetUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid pet update.',
        });
        return;
      }
      const scoped = db.forTenant(auth.tenant.id);
      const client = await findActiveClient(scoped, clientId);
      if (!client) {
        reply.code(404).send({ error: 'client_not_found', message: 'Client not found.' });
        return;
      }
      const existing = await findActivePet(scoped, client.id, petId);
      if (!existing) {
        reply.code(404).send({ error: 'pet_not_found', message: 'Pet not found.' });
        return;
      }
      const p = parsed.data;
      const updated = await scoped.pet.update({
        where: { id: existing.id },
        data: {
          ...(p.name !== undefined ? { name: p.name } : {}),
          ...(p.breed !== undefined ? { breed: p.breed } : {}),
          ...(p.weightLb !== undefined ? { weightLb: p.weightLb ?? null } : {}),
          ...(p.coatType !== undefined ? { coatType: toCoatType(p.coatType) } : {}),
          ...(p.temperamentNotes !== undefined ? { temperamentNotes: p.temperamentNotes } : {}),
          ...(p.preferredCutStyle !== undefined ? { preferredCutStyle: p.preferredCutStyle } : {}),
          ...(p.vaccinationExpiry !== undefined
            ? { vaccinationExpiry: p.vaccinationExpiry ? new Date(p.vaccinationExpiry) : null }
            : {}),
          ...(p.photoUrl !== undefined ? { photoUrl: p.photoUrl ?? null } : {}),
        },
      });
      reply.send({ pet: serializePet(updated) });
    },
  );
}
