import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, PlanTier } from '@mygroomtime/db';
import {
  SettingsSmsUpdateRequestSchema,
  type SettingsSmsStatus,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';

const PRO_PLUS: ReadonlySet<PlanTier> = new Set<PlanTier>([PlanTier.pro, PlanTier.business]);

export default async function settingsSmsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/settings/sms',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const tenant = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: { smsRemindersEnabled: true, plan: true },
      });
      if (!tenant) {
        reply.code(404).send({ error: 'tenant_not_found', message: 'Tenant not found.' });
        return;
      }
      const body: SettingsSmsStatus = {
        remindersEnabled: tenant.smsRemindersEnabled,
        tierAllowsReminders: PRO_PLUS.has(tenant.plan),
      };
      reply.send(body);
    },
  );

  app.post(
    '/settings/sms',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = SettingsSmsUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Toggle a valid setting.',
        });
        return;
      }
      const tenant = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: { plan: true },
      });
      if (!tenant) {
        reply.code(404).send({ error: 'tenant_not_found', message: 'Tenant not found.' });
        return;
      }
      // why: a Starter tenant can read their SMS settings (always off), but enabling is
      // tier-gated. The adapter would also no-op at fire time, but blocking the toggle on
      // is the actionable surface for "upgrade to use this".
      if (parsed.data.remindersEnabled && !PRO_PLUS.has(tenant.plan)) {
        reply.code(403).send({
          error: 'tier_gated',
          reason: 'tier_gated',
          message: 'Upgrade to Pro or Business to enable SMS reminders.',
        });
        return;
      }
      await db.global.tenant.update({
        where: { id: auth.tenant.id },
        data: { smsRemindersEnabled: parsed.data.remindersEnabled },
      });
      // why: deliberately do NOT walk existing jobs on toggle-off. Already-enqueued jobs
      // will fire naturally; the adapter's tier/opt-out checks + the worker's fire-time
      // status check handle the corner cases. This is the cheapest, race-free path.
      const body: SettingsSmsStatus = {
        remindersEnabled: parsed.data.remindersEnabled,
        tierAllowsReminders: PRO_PLUS.has(tenant.plan),
      };
      reply.send(body);
    },
  );
}
