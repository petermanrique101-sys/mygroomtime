import { db, PlanTier } from '@mygroomtime/db';
import type { CheckoutSessionCompletedEvent } from '../../../../adapters/stripe/types.js';

const TIER_TO_PLAN: Record<string, PlanTier> = {
  starter: PlanTier.starter,
  pro: PlanTier.pro,
  business: PlanTier.business,
};

export type HandlerResult = { ok: true } | { ok: false; reason: string };

export async function handleCheckoutCompleted(
  event: CheckoutSessionCompletedEvent,
): Promise<HandlerResult> {
  const tenantId = event.metadata.tenantId;
  if (!tenantId) return { ok: false, reason: 'missing tenantId metadata' };
  const tierRaw = event.metadata.tier;
  const plan = tierRaw ? TIER_TO_PLAN[tierRaw] : undefined;
  if (!plan) return { ok: false, reason: `unknown tier metadata: ${tierRaw}` };

  const currentPeriodEnd =
    typeof event.currentPeriodEnd === 'number'
      ? new Date(event.currentPeriodEnd * 1000)
      : null;

  await db.global.tenant.update({
    where: { id: tenantId },
    data: {
      plan,
      stripeSubscriptionId: event.subscriptionId,
      stripeSubscriptionStatus: 'active',
      currentPeriodEnd,
      pastDueAt: null,
    },
  });
  return { ok: true };
}
