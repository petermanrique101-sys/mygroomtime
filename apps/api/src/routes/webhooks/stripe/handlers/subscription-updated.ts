import type { FastifyInstance } from 'fastify';
import { db, PlanTier } from '@mygroomtime/db';
import type {
  SubscriptionCreatedEvent,
  SubscriptionUpdatedEvent,
} from '../../../../adapters/stripe/types.js';
import type { HandlerResult } from './checkout-completed.js';

type SubLifecycleEvent = SubscriptionCreatedEvent | SubscriptionUpdatedEvent;

function priceIdToPlan(app: FastifyInstance, priceId: string | null): PlanTier | null {
  if (!priceId) return null;
  if (priceId === app.appEnv.stripe.priceIdStarter) return PlanTier.starter;
  if (priceId === app.appEnv.stripe.priceIdPro) return PlanTier.pro;
  if (priceId === app.appEnv.stripe.priceIdBusiness) return PlanTier.business;
  return null;
}

export function makeSubscriptionLifecycleHandler(
  app: FastifyInstance,
): (event: SubLifecycleEvent) => Promise<HandlerResult> {
  return async (event: SubLifecycleEvent): Promise<HandlerResult> => {
    const tenant = await db.global.tenant.findFirst({
      where: { stripeSubscriptionId: event.subscriptionId },
      select: { id: true, plan: true, stripeSubscriptionItemId: true },
    });
    if (!tenant) return { ok: false, reason: 'no tenant matches subscription' };

    // why: status drives the cascade (active/past_due/canceled); priceId drives the
    // tier flip. Both can change in the same event when an owner upgrades from a
    // past_due Pro to Business after paying the failed invoice — handle both here.
    const tierFromPrice = priceIdToPlan(app, event.priceId);
    let nextPlan: PlanTier | null = null;
    if (event.status === 'past_due') nextPlan = PlanTier.past_due;
    else if (event.status === 'canceled') nextPlan = PlanTier.canceled;
    else if (event.status === 'active' && tierFromPrice) nextPlan = tierFromPrice;
    else if (event.type === 'customer.subscription.created' && tierFromPrice)
      nextPlan = tierFromPrice;

    const data: {
      stripeSubscriptionStatus: string;
      currentPeriodEnd: Date | null;
      stripeSubscriptionItemId?: string | null;
      plan?: PlanTier;
      lastPlanChangeAt?: Date;
    } = {
      stripeSubscriptionStatus: event.status,
      currentPeriodEnd:
        typeof event.currentPeriodEnd === 'number'
          ? new Date(event.currentPeriodEnd * 1000)
          : null,
    };

    if (event.subscriptionItemId) {
      data.stripeSubscriptionItemId = event.subscriptionItemId;
    }

    const planChanged = nextPlan !== null && nextPlan !== tenant.plan;
    if (planChanged) {
      data.plan = nextPlan!;
      // why: lastPlanChangeAt is only meaningful for tier flips, not status flips.
      // We treat past_due/canceled as cascade markers (existing chunk-10 policy) but
      // still stamp lastPlanChangeAt so the audit log captures the moment.
      data.lastPlanChangeAt = new Date();
    }

    await db.global.tenant.update({ where: { id: tenant.id }, data });

    if (planChanged && tenant.plan !== PlanTier.unpaid) {
      // why: only audit transitions between real tiers / status states — the unpaid →
      // first-tier flip is the signup, not a "plan change," and is already captured by
      // checkout-completed in the existing chunk-10 flow.
      await db.global.tenantPlanChange.upsert({
        where: { stripeEventId: event.id },
        update: {},
        create: {
          tenantId: tenant.id,
          fromPlan: tenant.plan,
          toPlan: nextPlan!,
          stripeEventId: event.id,
        },
      });
    }
    return { ok: true };
  };
}

export function makeSubscriptionUpdatedHandler(
  app: FastifyInstance,
): (event: SubscriptionUpdatedEvent) => Promise<HandlerResult> {
  return makeSubscriptionLifecycleHandler(app);
}

export function makeSubscriptionCreatedHandler(
  app: FastifyInstance,
): (event: SubscriptionCreatedEvent) => Promise<HandlerResult> {
  return makeSubscriptionLifecycleHandler(app);
}
