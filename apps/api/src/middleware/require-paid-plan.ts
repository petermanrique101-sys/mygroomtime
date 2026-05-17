import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export const requirePaidPlan: preHandlerAsyncHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  if (!request.auth) {
    reply.code(401).send({ error: 'auth_required', message: 'Sign in to continue.' });
    return;
  }
  const plan = request.auth.tenant.plan;

  if (plan === 'starter' || plan === 'pro' || plan === 'business') return;

  if (plan === 'past_due') {
    if (READ_METHODS.has(request.method.toUpperCase())) return;
    reply.code(403).send({
      error: 'plan_required',
      reason: 'past_due',
      message: 'Your last payment failed. Update your card to keep editing your schedule.',
      currentPlan: plan,
    });
    return;
  }

  if (plan === 'canceled') {
    reply.code(403).send({
      error: 'plan_required',
      reason: 'canceled',
      message: 'Your subscription is canceled. Reactivate a plan to continue.',
      currentPlan: plan,
    });
    return;
  }

  reply.code(403).send({
    error: 'plan_required',
    reason: 'unpaid',
    message: 'Choose a plan to start using MyGroomTime.',
    currentPlan: plan,
  });
};
