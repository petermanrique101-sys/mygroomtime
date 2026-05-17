import { db, PlanTier } from '@mygroomtime/db';
import type { SubscriptionUpdatedEvent } from '../../../../adapters/stripe/types.js';
import type { HandlerResult } from './checkout-completed.js';

export async function handleSubscriptionUpdated(
  event: SubscriptionUpdatedEvent,
): Promise<HandlerResult> {
  const tenant = await db.global.tenant.findFirst({
    where: { stripeSubscriptionId: event.subscriptionId },
    select: { id: true, plan: true },
  });
  if (!tenant) return { ok: false, reason: 'no tenant matches subscription' };

  const data: {
    stripeSubscriptionStatus: string;
    currentPeriodEnd: Date | null;
    plan?: PlanTier;
  } = {
    stripeSubscriptionStatus: event.status,
    currentPeriodEnd:
      typeof event.currentPeriodEnd === 'number'
        ? new Date(event.currentPeriodEnd * 1000)
        : null,
  };

  // why: cascade is one-way — payment_failed sets pastDueAt (banner only),
  // status=past_due flips plan to past_due (read-only), status=canceled flips to canceled.
  // We never auto-downgrade tier on failure.
  if (event.status === 'past_due') data.plan = PlanTier.past_due;
  if (event.status === 'canceled') data.plan = PlanTier.canceled;

  await db.global.tenant.update({ where: { id: tenant.id }, data });
  return { ok: true };
}
