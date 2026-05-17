import type { FastifyInstance } from 'fastify';
import listClientsRoute from './list.js';
import getClientRoute from './get.js';
import createClientRoute from './create.js';
import updateClientRoute from './update.js';
import deleteClientRoute from './delete.js';
import createPetRoute from './pets-create.js';
import updatePetRoute from './pets-update.js';
import deletePetRoute from './pets-delete.js';

export default async function clientRoutes(app: FastifyInstance): Promise<void> {
  await listClientsRoute(app);
  await getClientRoute(app);
  await createClientRoute(app);
  await updateClientRoute(app);
  await deleteClientRoute(app);
  await createPetRoute(app);
  await updatePetRoute(app);
  await deletePetRoute(app);
}
