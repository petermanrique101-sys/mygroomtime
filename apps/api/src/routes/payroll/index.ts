import type { FastifyInstance } from 'fastify';
import payrollPeriodsRoute from './periods.js';
import payrollSplitsRoute from './splits.js';
import payrollSplitsCsvRoute from './splits-csv.js';

export default async function payrollRoutes(app: FastifyInstance): Promise<void> {
  await payrollPeriodsRoute(app);
  await payrollSplitsRoute(app);
  await payrollSplitsCsvRoute(app);
}
