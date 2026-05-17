import type { FastifyInstance } from 'fastify';
import listAppointmentsRoute from './list.js';
import appointmentBuffersRoute from './buffers.js';
import getAppointmentRoute from './get.js';
import createAppointmentRoute from './create.js';
import updateAppointmentRoute from './update.js';
import deleteAppointmentRoute from './delete.js';

export default async function appointmentRoutes(app: FastifyInstance): Promise<void> {
  await listAppointmentsRoute(app);
  await appointmentBuffersRoute(app);
  await getAppointmentRoute(app);
  await createAppointmentRoute(app);
  await updateAppointmentRoute(app);
  await deleteAppointmentRoute(app);
}
