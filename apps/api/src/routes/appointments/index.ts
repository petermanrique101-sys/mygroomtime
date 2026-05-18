import type { FastifyInstance } from 'fastify';
import listAppointmentsRoute from './list.js';
import appointmentBuffersRoute from './buffers.js';
import getAppointmentRoute from './get.js';
import createAppointmentRoute from './create.js';
import updateAppointmentRoute from './update.js';
import deleteAppointmentRoute from './delete.js';
import routeViewRoute from './route-view.js';
import routeApplyRoute from './route-apply.js';

export default async function appointmentRoutes(app: FastifyInstance): Promise<void> {
  await listAppointmentsRoute(app);
  await appointmentBuffersRoute(app);
  // why: register the route-view + apply BEFORE get-by-id so /today/route doesn't get
  // captured by /appointments/:id (Fastify is order-insensitive but explicit is clearer).
  await routeViewRoute(app);
  await routeApplyRoute(app);
  await getAppointmentRoute(app);
  await createAppointmentRoute(app);
  await updateAppointmentRoute(app);
  await deleteAppointmentRoute(app);
}
