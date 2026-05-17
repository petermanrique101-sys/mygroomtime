import { db, PlanTier } from '@mygroomtime/db';
import type { SubscriptionDeletedEvent } from '../../../../adapters/stripe/types.js';
import type { HandlerResult } from './checkout-completed.js';

export async function handleSubscriptionDeleted(
  event: SubscriptionDeletedEvent,
): Promise<HandlerResult> {
  const tenant = await db.global.tenant.findFirst({
    where: { stripeSubscriptionId: event.subscriptionId },
    select: { id: true },
  });
  if (!tenant) return { ok: false, reason: 'no tenant matches subscription' };

  await db.global.tenant.update({
    where: { id: tenant.id },
    data: {
      plan: PlanTier.canceled,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: 'canceled',
      currentPeriodEnd: null,
    },
  });
  return { ok: true };
}
