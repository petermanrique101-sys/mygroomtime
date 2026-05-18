import type { FastifyInstance } from 'fastify';
import getPublicTenantRoute from './get-tenant.js';
import publicAvailabilityRoute from './availability.js';
import publicBookingSubmitRoute from './submit.js';
import publicBookingStatusRoute from './booking-status.js';
import publicRescheduleVerifyRoute from './reschedule-verify.js';
import publicRescheduleCommitRoute from './reschedule-commit.js';

export default async function publicRoutes(app: FastifyInstance): Promise<void> {
  await getPublicTenantRoute(app);
  await publicAvailabilityRoute(app);
  await publicBookingSubmitRoute(app);
  await publicBookingStatusRoute(app);
  await publicRescheduleVerifyRoute(app);
  await publicRescheduleCommitRoute(app);
}
