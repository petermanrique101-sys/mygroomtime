import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, AppointmentStatus, type Appointment, type Client, type Pet } from '@mygroomtime/db';
import {
  RouteOptimizeQuerySchema,
  type RouteOptimizeResponse,
  type RouteOptimizedStop,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { ensureDefaultVehicle } from './find.js';
import {
  optimizeRoute,
  type OptimizeRouteStop,
} from '../../services/route-optimization.js';
import { loadTenantDefaultBufferMin } from '../../services/buffers.js';

type Query = { date?: string; vehicleId?: string };
type ApptWithRels = Appointment & { client: Client; pet: Pet };

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.scheduled,
  AppointmentStatus.on_the_way,
  AppointmentStatus.started,
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseDate(raw: string | undefined): Date {
  if (!raw) {
    // why: tenant tz is not modeled yet. Server tz is the default; chunk 22 will plumb
    // through tenant-configurable time zone. TODO(chunk-22): respect tenant tz.
    return startOfDay(new Date());
  }
  return new Date(raw);
}

function toStop(
  s: OptimizeRouteStop,
  appt: ApptWithRels,
): RouteOptimizedStop {
  return {
    appointmentId: s.appointmentId,
    startSuggested: s.startSuggested.toISOString(),
    scheduledStart: appt.scheduledStart.toISOString(),
    durationMin: s.durationMin,
    driveFromPrevMin: s.driveFromPrevMin,
    timeLocked: appt.timeLocked,
    pet: { id: appt.pet.id, name: appt.pet.name },
    client: {
      id: appt.client.id,
      name: appt.client.name,
      street: appt.addressOverrideStreet ?? appt.client.addressStreet,
      city: appt.addressOverrideCity ?? appt.client.addressCity,
      zip: appt.addressOverrideZip ?? appt.client.addressZip,
      lat: appt.addressOverrideLat ?? appt.client.addressLat,
      lng: appt.addressOverrideLng ?? appt.client.addressLng,
    },
    serviceName: appt.serviceNameSnapshot,
  };
}

export default async function routeViewRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/appointments/today/route',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;

      if (auth.tenant.plan !== 'pro' && auth.tenant.plan !== 'business') {
        reply.code(403).send({
          error: 'plan_required',
          reason: 'tier_gated',
          message: 'Route optimization is a Pro feature. Upgrade to plan your day.',
          currentPlan: auth.tenant.plan,
        });
        return;
      }

      const q = request.query as Query;
      const parsed = RouteOptimizeQuerySchema.safeParse({
        date: q.date,
        vehicleId: q.vehicleId,
      });
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid query.',
        });
        return;
      }

      const scoped = db.forTenant(auth.tenant.id);
      const date = parseDate(parsed.data.date);
      const vehicleId = parsed.data.vehicleId ?? (await ensureDefaultVehicle(scoped));

      const tenantRow = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: { depotLat: true, depotLng: true },
      });
      const depot =
        tenantRow?.depotLat != null && tenantRow.depotLng != null
          ? { lat: tenantRow.depotLat, lng: tenantRow.depotLng }
          : null;

      const defaultBufferMin = await loadTenantDefaultBufferMin(auth.tenant.id);

      let result;
      try {
        result = await optimizeRoute({
          tenantId: auth.tenant.id,
          vehicleId,
          date,
          gmaps: app.adapters.gmaps,
          depotLatLng: depot,
          scoped,
          defaultBufferMin,
        });
      } catch (err) {
        request.log.error({ err }, 'optimizeRoute failed');
        reply.code(502).send({
          error: 'route_unavailable',
          message: 'Could not compute route — try again in a moment.',
        });
        return;
      }

      const apptIds = result.orderedStops.map((s) => s.appointmentId);
      const apptRows = (await scoped.appointment.findMany({
        where: {
          id: { in: apptIds.length > 0 ? apptIds : ['__none__'] },
          status: { in: ACTIVE_STATUSES },
          scheduledStart: { gte: startOfDay(date), lte: endOfDay(date) },
        },
        include: { client: true, pet: true },
      })) as ApptWithRels[];
      const byId = new Map(apptRows.map((a) => [a.id, a] as const));

      const stops: RouteOptimizedStop[] = [];
      for (const s of result.orderedStops) {
        const appt = byId.get(s.appointmentId);
        if (!appt) continue;
        stops.push(toStop(s, appt));
      }

      const body: RouteOptimizeResponse = {
        date: startOfDay(date).toISOString(),
        vehicleId,
        depotUsed: result.depotUsed,
        depot,
        totalDriveMin: result.totalDriveMin,
        warnings: result.warnings,
        stops,
      };
      reply.send(body);
    },
  );
}
