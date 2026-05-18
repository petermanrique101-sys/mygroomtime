import type { FastifyInstance } from 'fastify';
import gcalStatusRoute from './status.js';
import gcalConnectRoute from './connect.js';
import gcalCallbackRoute from './callback.js';
import gcalDisconnectRoute from './disconnect.js';

export default async function gcalIntegrationRoutes(app: FastifyInstance): Promise<void> {
  await gcalStatusRoute(app);
  await gcalConnectRoute(app);
  await gcalCallbackRoute(app);
  await gcalDisconnectRoute(app);
}
