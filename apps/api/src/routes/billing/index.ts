import type { FastifyInstance } from 'fastify';
import billingStatusRoute from './status.js';
import billingCheckoutRoute from './checkout.js';
import billingPortalRoute from './portal.js';

export default async function billingRoutes(app: FastifyInstance): Promise<void> {
  await billingStatusRoute(app);
  await billingCheckoutRoute(app);
  await billingPortalRoute(app);
}
