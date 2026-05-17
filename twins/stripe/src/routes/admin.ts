import type { FastifyInstance } from 'fastify';
import type { TwinState, TwinSubscription } from '../state.js';
import { deliverEvent, recordEvent, type WebhookConfig } from '../webhook.js';
import { serializeSubscription } from '../serialize.js';

type ReplayBody = { event_id?: string };
type SimulateDelayBody = { event_id?: string; ms?: number };
type SimulateEventBody = {
  type?: string;
  subscription_id?: string;
  customer_id?: string;
  status?: TwinSubscription['status'];
};

export function registerAdmin(
  app: FastifyInstance,
  state: TwinState,
  cfg: WebhookConfig,
): void {
  app.post('/__twin__/replay-event', async (req, reply) => {
    const body = (req.body ?? {}) as ReplayBody;
    const id = body.event_id;
    if (!id) {
      return reply.code(400).send({ error: 'event_id required' });
    }
    const event = state.events.get(id);
    if (!event) {
      return reply.code(404).send({ error: 'no such event' });
    }
    const result = await deliverEvent(cfg, event);
    return reply.code(200).send({ replayed: id, delivery: result });
  });

  app.post('/__twin__/simulate-delay', async (req, reply) => {
    const body = (req.body ?? {}) as SimulateDelayBody;
    const id = body.event_id;
    const ms = Number(body.ms);
    if (!id || !Number.isFinite(ms) || ms < 0) {
      return reply.code(400).send({ error: 'event_id + non-negative ms required' });
    }
    const event = state.events.get(id);
    if (!event) {
      return reply.code(404).send({ error: 'no such event' });
    }
    setTimeout(() => {
      void deliverEvent(cfg, event);
    }, ms).unref();
    return reply.code(202).send({ scheduled: id, delayMs: ms });
  });

  app.post('/__twin__/simulate-event', async (req, reply) => {
    const body = (req.body ?? {}) as SimulateEventBody;
    const type = body.type;
    if (!type) return reply.code(400).send({ error: 'type required' });

    if (type === 'invoice.payment_failed') {
      const subId = body.subscription_id;
      if (!subId || !state.subscriptions.has(subId)) {
        return reply.code(400).send({ error: 'unknown subscription_id' });
      }
      const sub = state.subscriptions.get(subId)!;
      const event = recordEvent(state, 'invoice.payment_failed', {
        id: state.ids.next('in'),
        object: 'invoice',
        subscription: sub.id,
        customer: sub.customer,
        amount_due: 0,
        attempt_count: 1,
      });
      const delivery = await deliverEvent(cfg, event);
      return reply.code(200).send({ event_id: event.id, delivery });
    }

    if (type === 'customer.subscription.updated') {
      const subId = body.subscription_id;
      if (!subId || !state.subscriptions.has(subId)) {
        return reply.code(400).send({ error: 'unknown subscription_id' });
      }
      const sub = state.subscriptions.get(subId)!;
      if (body.status) sub.status = body.status;
      state.subscriptions.set(sub.id, sub);
      const event = recordEvent(
        state,
        'customer.subscription.updated',
        serializeSubscription(sub),
      );
      const delivery = await deliverEvent(cfg, event);
      return reply.code(200).send({ event_id: event.id, delivery });
    }

    if (type === 'customer.subscription.deleted') {
      const subId = body.subscription_id;
      if (!subId || !state.subscriptions.has(subId)) {
        return reply.code(400).send({ error: 'unknown subscription_id' });
      }
      const sub = state.subscriptions.get(subId)!;
      sub.status = 'canceled';
      state.subscriptions.set(sub.id, sub);
      const event = recordEvent(
        state,
        'customer.subscription.deleted',
        serializeSubscription(sub),
      );
      const delivery = await deliverEvent(cfg, event);
      return reply.code(200).send({ event_id: event.id, delivery });
    }

    return reply.code(400).send({ error: `unsupported simulate-event type: ${type}` });
  });

  app.post('/__twin__/reset', async (_req, reply) => {
    state.reset();
    return reply.code(200).send({ ok: true });
  });

  app.post('/__twin__/webhook-config', async (req, reply) => {
    const body = (req.body ?? {}) as { url?: string | null; secret?: string };
    if (typeof body.url !== 'undefined') cfg.url = body.url;
    if (typeof body.secret === 'string') cfg.secret = body.secret;
    return reply.code(200).send({ url: cfg.url, hasSecret: cfg.secret.length > 0 });
  });
}
