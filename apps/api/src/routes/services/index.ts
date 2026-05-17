import type { FastifyInstance } from 'fastify';
import listServicesRoute from './list.js';
import getServiceRoute from './get.js';
import createServiceRoute from './create.js';
import updateServiceRoute from './update.js';
import deleteServiceRoute from './delete.js';

export default async function serviceRoutes(app: FastifyInstance): Promise<void> {
  await listServicesRoute(app);
  await getServiceRoute(app);
  await createServiceRoute(app);
  await updateServiceRoute(app);
  await deleteServiceRoute(app);
}
