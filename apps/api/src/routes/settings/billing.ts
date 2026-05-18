import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, PlanTier } from '@mygroomtime/db';
import {
  ChangePlanRequestSchema,
  PreviewPlanChangeRequestSchema,
  TIER_PRICE_CENTS,
  type ChangePlanResponse,
  type PaidPlanTier,
  type PortalSessionResponse,
  type PreviewPlanChangeResponse,
  type SettingsBillingResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';

const PAID_PLANS: ReadonlySet<PlanTier> = new Set<PlanTier>([
  PlanTier.starter,
  PlanTier.pro,
  PlanTier.business,
]);

function priceIdFor(tier: PaidPlanTier, app: FastifyInstance): string {
  if (tier === 'starter') return app.appEnv.stripe.priceIdStarter;
  if (tier === 'pro') return app.appEnv.stripe.priceIdPro;
  return app.appEnv.stripe.priceIdBusiness;
}

function planTierOf(plan: PlanTier): PaidPlanTier | null {
  if (plan === PlanTier.starter || plan === PlanTier.pro || plan === PlanTier.business) {
    return plan;
  }
  return null;
}

function reject403(reply: FastifyReply, plan: PlanTier): void {
  if (plan === PlanTier.past_due) {
    reply.code(403).send({
      error: 'plan_change_blocked',
      reason: 'past_due',
      message:
        "Your last payment failed. Update your card from the billing portal before changing plans.",
    });
    return;
  }
  if (plan === PlanTier.canceled) {
    reply.code(403).send({
      error: 'plan_change_blocked',
      reason: 'canceled',
      message: 'Reactivate a plan from the billing page before switching tiers.',
    });
    return;
  }
  reply.code(403).send({
    error: 'plan_change_blocked',
    reason: 'unpaid',
    message: 'Choose a plan before switching tiers.',
  });
}

type LoadedSub = {
  customerId: string;
  subscriptionId: string;
  plan: PlanTier;
};

async function loadSubscription(
  reply: FastifyReply,
  tenantId: string,
  currentPlan: PlanTier,
): Promise<LoadedSub | null> {
  const tenant = await db.global.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeCustomerId: true, stripeSubscriptionId: true },
  });
  if (!tenant?.stripeCustomerId || !tenant.stripeSubscriptionId) {
    reply.code(409).send({
      error: 'no_subscription',
      message:
        'No active Stripe subscription on file. Finish signup billing before changing plans.',
    });
    return null;
  }
  return {
    customerId: tenant.stripeCustomerId,
    subscriptionId: tenant.stripeSubscriptionId,
    plan: currentPlan,
  };
}

function idempotencyKey(tenantId: string, targetPlan: PaidPlanTier): string {
  // why: bucket the timestamp to 5-minute windows so an accidental double-click within
  // the same window is one Stripe call. A genuinely retry-an-hour-later request gets
  // a fresh key, which is the desired behavior (proration math will have shifted).
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  return `tenant-${tenantId}-${targetPlan}-${bucket}`;
}

export default async function settingsBillingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/settings/billing',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body: SettingsBillingResponse = {
        plan: auth.tenant.plan,
        currentPeriodEnd: auth.tenant.currentPeriodEnd
          ? auth.tenant.currentPeriodEnd.toISOString()
          : null,
        // why: payment-method presence isn't strictly tracked yet — having an active
        // subscription implies Stripe has a card on file from signup checkout. The
        // Customer Portal is the source of truth for managing it.
        hasPaymentMethod:
          PAID_PLANS.has(auth.tenant.plan) || auth.tenant.plan === PlanTier.past_due,
        available: [
          { tier: 'starter', priceMonthlyCents: TIER_PRICE_CENTS.starter },
          { tier: 'pro', priceMonthlyCents: TIER_PRICE_CENTS.pro },
          { tier: 'business', priceMonthlyCents: TIER_PRICE_CENTS.business },
        ],
      };
      reply.send(body);
    },
  );

  app.post(
    '/settings/billing/preview-plan-change',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = PreviewPlanChangeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Pick a plan to preview.',
        });
        return;
      }
      const currentTier = planTierOf(auth.tenant.plan);
      if (!currentTier) {
        reject403(reply, auth.tenant.plan);
        return;
      }
      if (currentTier === parsed.data.targetPlan) {
        reply.code(400).send({
          error: 'same_plan',
          message: "That's already your current plan.",
        });
        return;
      }
      const sub = await loadSubscription(reply, auth.tenant.id, auth.tenant.plan);
      if (!sub) return;

      const preview = await app.adapters.stripe.previewPlanChange({
        customerId: sub.customerId,
        subscriptionId: sub.subscriptionId,
        newPriceId: priceIdFor(parsed.data.targetPlan, app),
      });
      const body: PreviewPlanChangeResponse = {
        targetPlan: parsed.data.targetPlan,
        amountDueCents: preview.amountDueCents,
        creditCents: preview.creditCents,
        chargeCents: preview.chargeCents,
        currentPeriodEndIso: preview.currentPeriodEndIso,
        nextChargeCents: preview.nextChargeCents,
      };
      reply.send(body);
    },
  );

  app.post(
    '/settings/billing/change-plan',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = ChangePlanRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Pick a plan to switch to.',
        });
        return;
      }
      const currentTier = planTierOf(auth.tenant.plan);
      if (!currentTier) {
        reject403(reply, auth.tenant.plan);
        return;
      }
      if (currentTier === parsed.data.targetPlan) {
        reply.code(400).send({
          error: 'same_plan',
          message: "That's already your current plan.",
        });
        return;
      }
      const sub = await loadSubscription(reply, auth.tenant.id, auth.tenant.plan);
      if (!sub) return;

      await app.adapters.stripe.changePlan({
        subscriptionId: sub.subscriptionId,
        newPriceId: priceIdFor(parsed.data.targetPlan, app),
        idempotencyKey: idempotencyKey(auth.tenant.id, parsed.data.targetPlan),
      });
      const body: ChangePlanResponse = { pending: true, willTakeEffect: 'webhook' };
      reply.code(202).send(body);
    },
  );

  app.post(
    '/settings/billing/portal-session',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const tenant = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: { stripeCustomerId: true },
      });
      if (!tenant?.stripeCustomerId) {
        reply.code(409).send({
          error: 'no_customer',
          message: 'Finish signup billing before opening the customer portal.',
        });
        return;
      }
      const session = await app.adapters.stripe.createPortalSession({
        customerId: tenant.stripeCustomerId,
        returnUrl: `${app.appEnv.webOrigin}/settings/billing`,
      });
      const body: PortalSessionResponse = { url: session.url };
      reply.send(body);
    },
  );
}
