import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, type CoatType } from '@mygroomtime/db';
import { ClientCreateRequestSchema, type ClientMutationResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { geocodeOnWrite } from './geocode-address.js';
import { findActivePets } from './find.js';
import { serializeClientWithPets } from './serialize.js';

function toCoatType(value: string): CoatType {
  return value as CoatType;
}

export default async function createClientRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/clients',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'client' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = ClientCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid client details.',
          issues: parsed.error.issues,
        });
        return;
      }
      const input = parsed.data;
      const scoped = db.forTenant(auth.tenant.id);

      const outcome = await geocodeOnWrite(app.adapters.geocode, input, reply);
      if (!outcome.ok) return;

      const created = await scoped.client.create({
        data: {
          name: input.name,
          phone: input.phone,
          email: input.email ?? null,
          addressStreet: input.street,
          addressCity: input.city,
          addressState: input.state,
          addressZip: input.zip,
          addressLat: outcome.lat,
          addressLng: outcome.lng,
          addressVerified: outcome.verified,
          notes: input.notes ?? '',
          preferredGroomerId: input.preferredGroomerId ?? null,
          pets: {
            create: input.pets.map((p) => ({
              tenantId: auth.tenant.id,
              name: p.name,
              breed: p.breed,
              weightLb: p.weightLb ?? null,
              coatType: toCoatType(p.coatType),
              temperamentNotes: p.temperamentNotes ?? '',
              preferredCutStyle: p.preferredCutStyle ?? '',
              vaccinationExpiry: p.vaccinationExpiry ? new Date(p.vaccinationExpiry) : null,
              photoUrl: p.photoUrl ?? null,
            })),
          },
        },
      });

      const pets = await findActivePets(scoped, created.id);
      const body: ClientMutationResponse = {
        client: serializeClientWithPets(created, pets),
        warning: outcome.verified ? null : { code: 'address_unverified', message: outcome.warning },
      };
      reply.code(201).send(body);
    },
  );
}
