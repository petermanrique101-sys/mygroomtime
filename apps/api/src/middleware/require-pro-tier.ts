import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

// why: chunk-13 set tier capabilities. Google Calendar sync is Pro+. We share one
// middleware so the same 403 shape is returned everywhere a Pro feature lives.
export const requireProTier: preHandlerAsyncHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  if (!request.auth) {
    reply.code(401).send({ error: 'auth_required', message: 'Sign in to continue.' });
    return;
  }
  const plan = request.auth.tenant.plan;
  if (plan === 'pro' || plan === 'business') return;
  reply.code(403).send({
    error: 'plan_required',
    reason: 'tier_gated',
    message: 'Google Calendar sync is a Pro feature. Upgrade to connect your calendar.',
    currentPlan: plan,
    requiredPlan: 'pro',
  });
};
