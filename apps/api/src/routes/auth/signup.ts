import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SignupRequestSchema } from '@mygroomtime/shared';
import { db, isUniqueViolation, UserRole, PlanTier } from '@mygroomtime/db';
import { hashPassword } from '../../auth/argon.js';
import { issueSession } from '../../auth/session.js';
import { slugifyBusinessName, pickAvailableSlug } from '../../auth/slug.js';

export default async function signupRoute(app: FastifyInstance): Promise<void> {
  app.post('/auth/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = SignupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid signup details.',
      });
      return;
    }
    const { email, password, businessName } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    const hashed = await hashPassword(password);
    const baseSlug = slugifyBusinessName(businessName);

    const existing = await db.global.$transaction(async (tx) => {
      return tx.user.findFirst({ where: { email: normalizedEmail }, select: { id: true } });
    });
    if (existing) {
      reply.code(409).send({
        error: 'email_taken',
        message: 'An account with this email already exists. Try signing in.',
      });
      return;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = await pickAvailableSlug(baseSlug);
      try {
        const result = await db.global.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: { slug, businessName: businessName.trim(), plan: PlanTier.unpaid },
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
          const user = await tx.user.create({
            data: {
              tenantId: tenant.id,
              email: normalizedEmail,
              hashedPassword: hashed,
              role: UserRole.owner,
              name: normalizedEmail.split('@')[0] ?? 'Owner',
            },
            select: { id: true, email: true, name: true, role: true },
          });
          return { tenant, user };
        });

        const session = await issueSession(
          reply,
          app.sessionStore,
          app.appEnv.nodeEnv === 'production',
          result.user,
          result.tenant,
        );
        reply.code(201).send(session);
        return;
      } catch (err) {
        if (isUniqueViolation(err, 'email')) {
          reply.code(409).send({
            error: 'email_taken',
            message: 'An account with this email already exists. Try signing in.',
          });
          return;
        }
        if (isUniqueViolation(err, 'slug')) continue;
        throw err;
      }
    }

    reply.code(409).send({
      error: 'slug_unavailable',
      message: 'Could not generate a unique business URL. Try a slightly different business name.',
    });
  });
}
