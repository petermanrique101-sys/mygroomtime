import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

// why: chunk-21 multi-vehicle dispatch + payroll + operations calendar are Business-only.
// We share one middleware so the 403 shape is consistent across vehicle CRUD, payroll,
// dispatch routes, and the operations-calendar OAuth flow. Runs AFTER requirePaidPlan so
// callers must compose [requireAuth, requirePaidPlan, requireBusinessTier].
export const requireBusinessTier: preHandlerAsyncHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  if (!request.auth) {
    reply.code(401).send({ error: 'auth_required', message: 'Sign in to continue.' });
    return;
  }
  const plan = request.auth.tenant.plan;
  if (plan === 'business') return;
  reply.code(403).send({
    error: 'plan_required',
    reason: 'business_tier_required',
    message: 'This feature requires the Business plan.',
    currentPlan: plan,
    requiredPlan: 'business',
  });
};
