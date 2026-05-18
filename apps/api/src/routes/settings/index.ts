import type { FastifyInstance } from 'fastify';
import settingsPaymentsRoutes from './payments.js';

export default async function settingsRoutes(app: FastifyInstance): Promise<void> {
  await settingsPaymentsRoutes(app);
}
