import type { FastifyInstance } from 'fastify';
import getPublicTenantRoute from './get-tenant.js';
import publicAvailabilityRoute from './availability.js';

export default async function publicRoutes(app: FastifyInstance): Promise<void> {
  await getPublicTenantRoute(app);
  await publicAvailabilityRoute(app);
}
