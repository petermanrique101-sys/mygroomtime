import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginRequestSchema } from '@mygroomtime/shared';
import { db } from '@mygroomtime/db';
import { verifyPassword } from '../../auth/argon.js';
import { issueSession } from '../../auth/session.js';

const GENERIC_FAIL = {
  error: 'invalid_credentials',
  message: 'Invalid email or password.',
};

export default async function loginRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = LoginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(401).send(GENERIC_FAIL);
        return;
      }
      const { email, password } = parsed.data;
      const normalized = email.trim().toLowerCase();

      const user = await db.global.$transaction(async (tx) => {
        return tx.user.findFirst({
          where: { email: normalized },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            tenantId: true,
            hashedPassword: true,
          },
        });
      });
      if (!user || !user.hashedPassword) {
        reply.code(401).send(GENERIC_FAIL);
        return;
      }
      const ok = await verifyPassword(user.hashedPassword, password);
      if (!ok) {
        reply.code(401).send(GENERIC_FAIL);
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
        reply.code(401).send(GENERIC_FAIL);
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
