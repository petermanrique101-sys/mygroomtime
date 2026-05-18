import type { FastifyInstance } from 'fastify';
import type { TwinPaymentIntent, TwinState, TwinPaymentIntentStatus } from '../state.js';
import { asMetadata, asRecord, asString } from '../form-body.js';
import { deliverEvent, recordEvent, type WebhookConfig } from '../webhook.js';
import { serializePaymentIntent } from '../serialize.js';

function destinationFromTransferData(v: unknown): string | undefined {
  const rec = asRecord(v);
  if (!rec) return undefined;
  return asString(rec.destination);
}

type TokenOutcome = {
  status: TwinPaymentIntentStatus;
  error: { code: string; message: string } | null;
  fireDisputeAfterMs?: number;
};

function outcomeForToken(token: string | undefined): TokenOutcome {
  switch (token) {
    case 'tok_visa_decline':
      return {
        status: 'requires_payment_method',
        error: { code: 'card_declined', message: 'Your card was declined.' },
      };
    case 'tok_visa_insuf':
      return {
        status: 'requires_payment_method',
        error: { code: 'insufficient_funds', message: 'Your card has insufficient funds.' },
      };
    case 'tok_visa_3ds':
      return { status: 'requires_action', error: null };
    case 'tok_visa_dispute':
      return { status: 'succeeded', error: null, fireDisputeAfterMs: 5000 };
    case 'tok_visa_ok':
    default:
      return { status: 'succeeded', error: null };
  }
}

export function registerPaymentIntents(
  app: FastifyInstance,
  state: TwinState,
  cfg: WebhookConfig,
): void {
  app.post('/v1/payment_intents', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply
        .code(400)
        .send({ error: { type: 'invalid_request_error', message: 'amount required' } });
    }
    // why: real Stripe carries the connected account on `transfer_data[destination]`
    // for direct charges with destination, with `on_behalf_of` as a separate hint.
    // We accept either, preferring transfer_data since that's the canonical field.
    const connectedAccountId =
      destinationFromTransferData(body.transfer_data) ??
      asString(body.on_behalf_of) ??
      'acct_TWIN_default';
    const idempotencyKey =
      asString(req.headers['idempotency-key']) ??
      asString(req.headers['Idempotency-Key']);
    if (idempotencyKey) {
      const existing = state.idempotencyKeys.get(idempotencyKey);
      if (existing) {
        const reused = state.paymentIntents.get(existing);
        if (reused) return reply.code(200).send(serializePaymentIntent(reused));
      }
    }
    const pi: TwinPaymentIntent = {
      id: state.ids.next('pi'),
      amount,
      currency: asString(body.currency) ?? 'usd',
      connectedAccountId,
      status: 'requires_confirmation',
      clientSecret: `${state.ids.next('pi_secret')}_secret`,
      lastPaymentError: null,
      metadata: asMetadata(body.metadata),
    };
    state.paymentIntents.set(pi.id, pi);
    if (idempotencyKey) state.idempotencyKeys.set(idempotencyKey, pi.id);
    return reply.code(200).send(serializePaymentIntent(pi));
  });

  app.post<{ Params: { id: string } }>('/v1/payment_intents/:id/confirm', async (req, reply) => {
    const pi = state.paymentIntents.get(req.params.id);
    if (!pi) {
      return reply
        .code(404)
        .send({ error: { type: 'invalid_request_error', message: 'No such payment_intent' } });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = asString(body.payment_method) ?? asString(body.source) ?? 'tok_visa_ok';
    const outcome = outcomeForToken(token);
    pi.status = outcome.status;
    pi.lastPaymentError = outcome.error;
    state.paymentIntents.set(pi.id, pi);

    if (outcome.status === 'succeeded') {
      const event = recordEvent(state, 'payment_intent.succeeded', serializePaymentIntent(pi));
      void deliverEvent(cfg, event);
      if (outcome.fireDisputeAfterMs) {
        setTimeout(() => {
          const dispute = recordEvent(state, 'charge.dispute.created', {
            id: state.ids.next('dp'),
            object: 'dispute',
            payment_intent: pi.id,
            amount: pi.amount,
          });
          void deliverEvent(cfg, dispute);
        }, outcome.fireDisputeAfterMs).unref();
      }
    } else if (outcome.status === 'requires_payment_method') {
      const event = recordEvent(state, 'payment_intent.payment_failed', serializePaymentIntent(pi));
      void deliverEvent(cfg, event);
    }
    return reply.code(200).send(serializePaymentIntent(pi));
  });
}

export function registerRefunds(
  app: FastifyInstance,
  state: TwinState,
  _cfg: WebhookConfig,
): void {
  app.post('/v1/refunds', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const paymentIntentId = asString(body.payment_intent);
    if (!paymentIntentId || !state.paymentIntents.has(paymentIntentId)) {
      return reply
        .code(400)
        .send({ error: { type: 'invalid_request_error', message: 'payment_intent required' } });
    }
    const pi = state.paymentIntents.get(paymentIntentId)!;
    const amount = Number.isFinite(Number(body.amount)) ? Number(body.amount) : pi.amount;
    const refund = {
      id: state.ids.next('re'),
      paymentIntentId,
      amount,
      created: Math.floor(Date.now() / 1000),
    };
    state.refunds.set(refund.id, refund);
    return reply.code(200).send({
      id: refund.id,
      object: 'refund',
      payment_intent: refund.paymentIntentId,
      amount: refund.amount,
      created: refund.created,
    });
  });
}
