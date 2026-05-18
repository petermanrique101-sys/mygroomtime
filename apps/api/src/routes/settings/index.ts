import type { FastifyInstance } from 'fastify';
import settingsPaymentsRoutes from './payments.js';
import settingsBillingRoutes from './billing.js';
import settingsSmsRoutes from './sms.js';
import gcalIntegrationRoutes from './integrations/google-calendar/index.js';

export default async function settingsRoutes(app: FastifyInstance): Promise<void> {
  await settingsPaymentsRoutes(app);
  await settingsBillingRoutes(app);
  await settingsSmsRoutes(app);
  await gcalIntegrationRoutes(app);
}
