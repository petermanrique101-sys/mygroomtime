import type { FastifyInstance } from 'fastify';
import gcalOpsStatusRoute from './status.js';
import gcalOpsConnectRoute from './connect.js';
import gcalOpsDisconnectRoute from './disconnect.js';

export default async function gcalOpsIntegrationRoutes(app: FastifyInstance): Promise<void> {
  await gcalOpsStatusRoute(app);
  await gcalOpsConnectRoute(app);
  await gcalOpsDisconnectRoute(app);
}
