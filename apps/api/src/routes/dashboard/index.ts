import type { FastifyInstance } from 'fastify';
import dashboardSummaryRoute from './summary.js';
import dashboardRevenueRoute from './revenue.js';
import dashboardNoShowsRoute from './no-shows.js';
import dashboardTopClientsRoute from './top-clients.js';
import dashboardGapsToFillRoute from './gaps-to-fill.js';

export default async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  await dashboardSummaryRoute(app);
  await dashboardRevenueRoute(app);
  await dashboardNoShowsRoute(app);
  await dashboardTopClientsRoute(app);
  await dashboardGapsToFillRoute(app);
}
