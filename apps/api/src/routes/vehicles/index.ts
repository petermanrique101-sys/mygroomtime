import type { FastifyInstance } from 'fastify';
import listVehiclesRoute from './list.js';
import createVehicleRoute from './create.js';
import updateVehicleRoute from './update.js';
import deleteVehicleRoute from './delete.js';

export default async function vehicleRoutes(app: FastifyInstance): Promise<void> {
  await listVehiclesRoute(app);
  await createVehicleRoute(app);
  await updateVehicleRoute(app);
  await deleteVehicleRoute(app);
}
