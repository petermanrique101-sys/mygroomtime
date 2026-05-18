import type { FastifyInstance } from 'fastify';
import type { TwinState, TwinSubscription, TwinSubscriptionStatus } from '../state.js';
import { asMetadata, asString, firstItem } from '../form-body.js';
import { recordEvent, deliverEvent } from '../webhook.js';
import { serializeSubscription } from '../serialize.js';
import type { WebhookConfig } from '../webhook.js';

const THIRTY_DAYS_SEC = 60 * 60 * 24 * 30;

export function buildSubscription(
  state: TwinState,
  customerId: string,
  priceId: string,
  metadata: Record<string, string>,
): TwinSubscription {
  const now = Math.floor(Date.now() / 1000);
  const sub: TwinSubscription = {
    id: state.ids.next('sub'),
    customer: customerId,
    priceId,
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: now + THIRTY_DAYS_SEC,
    cancelAtPeriodEnd: false,
    metadata,
  };
  state.subscriptions.set(sub.id, sub);
  return sub;
}

function isStatus(v: string | undefined): v is TwinSubscriptionStatus {
  return (
    v === 'active' || v === 'past_due' || v === 'canceled' || v === 'unpaid' || v === 'incomplete'
  );
}

export function registerSubscriptions(
  app: FastifyInstance,
  state: TwinState,
  cfg: WebhookConfig,
): void {
  app.post('/v1/subscriptions', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const customerId = asString(body.customer);
    if (!customerId || !state.customers.has(customerId)) {
      return reply
        .code(400)
        .send({ error: { type: 'invalid_request_error', message: 'customer required' } });
    }
    const item = firstItem(body.items);
    const priceId = asString(item?.price) ?? asString(body.price) ?? '';
    if (!priceId) {
      return reply
        .code(400)
        .send({ error: { type: 'invalid_request_error', message: 'price required' } });
    }
    const sub = buildSubscription(state, customerId, priceId, asMetadata(body.metadata));
    return reply.code(200).send(serializeSubscription(sub));
  });

  app.get<{ Params: { id: string } }>('/v1/subscriptions/:id', async (req, reply) => {
    const sub = state.subscriptions.get(req.params.id);
    if (!sub) {
      return reply
        .code(404)
        .send({ error: { type: 'invalid_request_error', message: 'No such subscription' } });
    }
    return reply.code(200).send(serializeSubscription(sub));
  });

  app.post<{ Params: { id: string } }>('/v1/subscriptions/:id', async (req, reply) => {
    const sub = state.subscriptions.get(req.params.id);
    if (!sub) {
      return reply
        .code(404)
        .send({ error: { type: 'invalid_request_error', message: 'No such subscription' } });
    }
    // why: real Stripe replays a cached response when the same idempotency key shows up
    // and never re-fires the resulting webhook. Mirror that so the route's double-click
    // protection is testable here too.
    const idemKey =
      asString(req.headers['idempotency-key']) ?? asString(req.headers['Idempotency-Key']);
    if (idemKey) {
      const cachedId = state.idempotencyKeys.get(idemKey);
      if (cachedId === sub.id) {
        return reply.code(200).send(serializeSubscription(sub));
      }
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const item = firstItem(body.items);
    const newPrice = asString(item?.price) ?? asString(body.price);
    if (newPrice) sub.priceId = newPrice;
    const newStatus = asString(body.status);
    if (isStatus(newStatus)) sub.status = newStatus;
    state.subscriptions.set(sub.id, sub);
    if (idemKey) state.idempotencyKeys.set(idemKey, sub.id);
    const event = recordEvent(state, 'customer.subscription.updated', serializeSubscription(sub));
    void deliverEvent(cfg, event);
    return reply.code(200).send(serializeSubscription(sub));
  });

  app.delete<{ Params: { id: string } }>('/v1/subscriptions/:id', async (req, reply) => {
    const sub = state.subscriptions.get(req.params.id);
    if (!sub) {
      return reply
        .code(404)
        .send({ error: { type: 'invalid_request_error', message: 'No such subscription' } });
    }
    sub.status = 'canceled';
    state.subscriptions.set(sub.id, sub);
    const serialized = serializeSubscription(sub);
    const event = recordEvent(state, 'customer.subscription.deleted', serialized);
    void deliverEvent(cfg, event);
    return reply.code(200).send(serialized);
  });
}
