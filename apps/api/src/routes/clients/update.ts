import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, type Client } from '@mygroomtime/db';
import {
  ClientAddressSchema,
  ClientUpdateSchema,
  type ClientMutationResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { findActiveClient, findActivePets } from './find.js';
import { geocodeOnWrite } from './geocode-address.js';
import { serializeClientWithPets } from './serialize.js';

type Params = { id: string };

function addressChanged(
  existing: Client,
  next: { street?: string; city?: string; state?: string; zip?: string },
): boolean {
  return (
    (next.street !== undefined && next.street !== existing.addressStreet) ||
    (next.city !== undefined && next.city !== existing.addressCity) ||
    (next.state !== undefined && next.state !== existing.addressState) ||
    (next.zip !== undefined && next.zip !== existing.addressZip)
  );
}

export default async function updateClientRoute(app: FastifyInstance): Promise<void> {
  app.patch(
    '/clients/:id',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'client' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const parsed = ClientUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid update.',
        });
        return;
      }
      const input = parsed.data;
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await findActiveClient(scoped, id);
      if (!existing) {
        reply.code(404).send({ error: 'client_not_found', message: 'Client not found.' });
        return;
      }

      const merged = {
        street: input.street ?? existing.addressStreet,
        city: input.city ?? existing.addressCity,
        state: input.state ?? existing.addressState,
        zip: input.zip ?? existing.addressZip,
      };

      let geoFields: { addressLat: number | null; addressLng: number | null; addressVerified: boolean } = {
        addressLat: existing.addressLat,
        addressLng: existing.addressLng,
        addressVerified: existing.addressVerified,
      };
      let warningMessage: string | null = null;

      if (addressChanged(existing, input)) {
        const addr = ClientAddressSchema.parse(merged);
        const outcome = await geocodeOnWrite(app.adapters.geocode, addr, reply);
        if (!outcome.ok) return;
        geoFields = {
          addressLat: outcome.lat,
          addressLng: outcome.lng,
          addressVerified: outcome.verified,
        };
        if (!outcome.verified) warningMessage = outcome.warning;
      }

      const updated = await scoped.client.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.email !== undefined ? { email: input.email ?? null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.preferredGroomerId !== undefined
            ? { preferredGroomerId: input.preferredGroomerId ?? null }
            : {}),
          addressStreet: merged.street,
          addressCity: merged.city,
          addressState: merged.state,
          addressZip: merged.zip,
          ...geoFields,
        },
      });

      const pets = await findActivePets(scoped, updated.id);
      const body: ClientMutationResponse = {
        client: serializeClientWithPets(updated, pets),
        warning: warningMessage
          ? { code: 'address_unverified', message: warningMessage }
          : null,
      };
      reply.send(body);
    },
  );
}
