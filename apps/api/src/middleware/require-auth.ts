import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { db } from '@mygroomtime/db';
import { SESSION_COOKIE, clearedCookieOptions } from '../auth/cookie.js';

function isProd(req: FastifyRequest): boolean {
  return req.server.appEnv.nodeEnv === 'production';
}

async function fail(req: FastifyRequest, reply: FastifyReply, sid?: string): Promise<void> {
  if (sid) await req.server.sessionStore.destroy(sid);
  reply.clearCookie(SESSION_COOKIE, clearedCookieOptions(isProd(req)));
  reply.code(401).send({ error: 'auth_required', message: 'Sign in to continue.' });
}

export const requireAuth: preHandlerAsyncHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) {
    reply.code(401).send({ error: 'auth_required', message: 'Sign in to continue.' });
    return;
  }
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) {
    await fail(request, reply);
    return;
  }
  const sid = unsigned.value;
  const payload = await request.server.sessionStore.touch(sid);
  if (!payload) {
    await fail(request, reply);
    return;
  }

  const tenant = await db.global.tenant.findUnique({
    where: { id: payload.tenantId },
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
    await fail(request, reply, sid);
    return;
  }

  const user = await db
    .forTenant(payload.tenantId)
    .user.findFirst({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, role: true },
    });
  if (!user) {
    await fail(request, reply, sid);
    return;
  }

  request.auth = { sid, user, tenant };
};
