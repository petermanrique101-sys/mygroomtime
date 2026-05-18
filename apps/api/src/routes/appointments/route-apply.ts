import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, AppointmentStatus } from '@mygroomtime/db';
import {
  RouteApplyRequestSchema,
  type RouteApplyResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { rescheduleAppointmentReminders } from '../../services/reminder-schedule.js';

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

class ConcurrentModError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrentModError';
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

type ApplyOutcome = {
  applied: number;
  unchanged: number;
  appliedIds: string[];
};

type Slot = { id: string; start: Date; durationMin: number };

export default async function routeApplyRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/appointments/today/route/apply',
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

      const parsed = RouteApplyRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid apply request.',
        });
        return;
      }
      const input = parsed.data;
      const tenantId = auth.tenant.id;
      const date = new Date(input.date);

      let outcome: ApplyOutcome;
      try {
        outcome = await db.global.$transaction(async (tx) => {
          const targetIds = input.stops.map((s) => s.appointmentId);
          const targets = await tx.appointment.findMany({
            where: { id: { in: targetIds }, tenantId, vehicleId: input.vehicleId },
          });
          if (targets.length !== targetIds.length) {
            throw new NotFoundError('Some appointments do not belong to this vehicle.');
          }
          for (const t of targets) {
            if (!ACTIVE_STATUSES.includes(t.status)) {
              throw new ConcurrentModError(
                `Appointment ${t.id} is no longer active.`,
              );
            }
          }

          const changes = new Map<string, Date>();
          let unchanged = 0;
          for (const s of input.stops) {
            const target = targets.find((t) => t.id === s.appointmentId)!;
            const newStart = new Date(s.startSuggested);
            if (newStart.getTime() === target.scheduledStart.getTime()) {
              unchanged += 1;
              continue;
            }
            changes.set(s.appointmentId, newStart);
          }

          if (changes.size === 0) {
            return { applied: 0, unchanged, appliedIds: [] };
          }

          const others = await tx.appointment.findMany({
            where: {
              tenantId,
              vehicleId: input.vehicleId,
              status: { in: ACTIVE_STATUSES },
              scheduledStart: { gte: startOfDay(date), lte: endOfDay(date) },
              NOT: { id: { in: targetIds } },
            },
          });

          const slots: Slot[] = [
            ...others.map((o) => ({
              id: o.id,
              start: o.scheduledStart,
              durationMin: o.durationMin,
            })),
            ...targets.map((t) => ({
              id: t.id,
              start: changes.get(t.id) ?? t.scheduledStart,
              durationMin: t.durationMin,
            })),
          ];
          slots.sort((a, b) => a.start.getTime() - b.start.getTime());
          for (let i = 1; i < slots.length; i += 1) {
            const prev = slots[i - 1]!;
            const cur = slots[i]!;
            const prevEnd = prev.start.getTime() + prev.durationMin * 60_000;
            if (cur.start.getTime() < prevEnd) {
              throw new ConcurrentModError(
                'Schedule changed since optimization.',
              );
            }
          }

          const appliedIds: string[] = [];
          for (const [id, newStart] of changes) {
            await tx.appointment.update({
              where: { id },
              data: { scheduledStart: newStart },
            });
            appliedIds.push(id);
          }
          return { applied: appliedIds.length, unchanged, appliedIds };
        });
      } catch (err) {
        if (err instanceof ConcurrentModError) {
          reply.code(409).send({
            error: 'route_apply_conflict',
            reason: 'concurrent_modification',
            message:
              'Schedule changed since optimization — please re-run optimize and try again.',
          });
          return;
        }
        if (err instanceof NotFoundError) {
          reply.code(404).send({ error: 'appointment_not_found', message: err.message });
          return;
        }
        throw err;
      }

      if (outcome.applied > 0 && app.reminderQueue) {
        const tenantRow = await db.global.tenant.findUnique({
          where: { id: tenantId },
          select: { smsRemindersEnabled: true },
        });
        const enabled = tenantRow?.smsRemindersEnabled === true;
        // why: refetch each applied appointment to get the post-update scheduledStart,
        // then drive the chunk-15 reminder reschedule helper. Without this the 48h/2h/post
        // jobs would still be sitting on the OLD delay and fire at the wrong wall-clock time.
        const scoped = db.forTenant(tenantId);
        for (const id of outcome.appliedIds) {
          const row = await scoped.appointment.findFirst({ where: { id } });
          if (!row) continue;
          await rescheduleAppointmentReminders(
            app.reminderQueue,
            {
              id: row.id,
              scheduledStart: row.scheduledStart,
              durationMin: row.durationMin,
            },
            tenantId,
            enabled,
          );
        }
      }

      const body: RouteApplyResponse = {
        applied: outcome.applied,
        unchanged: outcome.unchanged,
      };
      reply.send(body);
    },
  );
}
