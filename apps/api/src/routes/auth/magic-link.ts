import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MagicLinkRequestSchema, MagicLinkConsumeSchema } from '@mygroomtime/shared';
import { db } from '@mygroomtime/db';
import { MAGIC_TTL_SEC, signMagicLink, verifyMagicLink } from '../../auth/magic.js';
import { issueSession } from '../../auth/session.js';

export default async function magicLinkRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/magic-link/request',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = MagicLinkRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(204).send();
        return;
      }
      const normalized = parsed.data.email.trim().toLowerCase();
      const user = await db.global.$transaction(async (tx) => {
        return tx.user.findFirst({ where: { email: normalized }, select: { id: true } });
      });

      if (user) {
        const { token, jti } = await signMagicLink(user.id, app.appEnv.magicLinkSecret);
        await app.sessionStore.recordMagicJti(jti, MAGIC_TTL_SEC);
        const url = `${app.appEnv.webOrigin}/magic-link/consume?token=${encodeURIComponent(token)}`;
        await app.emailAdapter.sendMagicLink({ to: normalized, url });
      }
      reply.code(204).send();
    },
  );

  app.post(
    '/auth/magic-link/consume',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = MagicLinkConsumeSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_token',
          message: 'Magic link is invalid. Request a new one.',
        });
        return;
      }
      const result = await verifyMagicLink(parsed.data.token, app.appEnv.magicLinkSecret);
      if (!result.ok) {
        reply.code(400).send({
          error: result.reason === 'expired' ? 'link_expired' : 'invalid_token',
          message:
            result.reason === 'expired'
              ? 'This magic link has expired. Request a new one.'
              : 'This magic link is not valid.',
        });
        return;
      }

      const consumed = await app.sessionStore.consumeMagicJti(result.jti);
      if (!consumed) {
        reply.code(400).send({
          error: 'link_already_used',
          message: 'This magic link has already been used. Request a new one.',
        });
        return;
      }

      const user = await db.global.$transaction(async (tx) => {
        return tx.user.findFirst({
          where: { id: result.userId },
          select: { id: true, email: true, name: true, role: true, tenantId: true },
        });
      });
      if (!user) {
        reply.code(400).send({
          error: 'invalid_token',
          message: 'This magic link is not valid.',
        });
        return;
      }
      const tenant = await db.global.tenant.findUnique({
        where: { id: user.tenantId },
        select: {
          id: true,
          slug: true,
          businessName: true,
          plan: true,
          stripeSubscriptionStatus: true,
          currentPeriodEnd: true,
          pastDueAt: true,
        },
      });
      if (!tenant) {
        reply.code(400).send({
          error: 'invalid_token',
          message: 'This magic link is not valid.',
        });
        return;
      }

      await db
        .forTenant(tenant.id)
        .user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      const session = await issueSession(
        reply,
        app.sessionStore,
        app.appEnv.nodeEnv === 'production',
        { id: user.id, email: user.email, name: user.name, role: user.role },
        tenant,
      );
      reply.send(session);
    },
  );
}
