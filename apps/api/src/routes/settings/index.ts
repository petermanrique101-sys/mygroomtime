import type { FastifyInstance } from 'fastify';
import settingsPaymentsRoutes from './payments.js';
import settingsBillingRoutes from './billing.js';

export default async function settingsRoutes(app: FastifyInstance): Promise<void> {
  await settingsPaymentsRoutes(app);
  await settingsBillingRoutes(app);
}
