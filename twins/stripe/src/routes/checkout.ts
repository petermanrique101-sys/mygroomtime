import type { FastifyInstance } from 'fastify';
import type { TwinCheckoutSession, TwinState } from '../state.js';
import { asMetadata, asString, firstItem } from '../form-body.js';
import { recordEvent, deliverEvent, type WebhookConfig } from '../webhook.js';
import { buildSubscription } from './subscriptions.js';
import { serializeCheckoutSession, serializeSubscription } from '../serialize.js';
import { lookupPrice } from '../prices.js';

function pickPriceId(body: Record<string, unknown>): string | undefined {
  const first = firstItem(body.line_items);
  const priceId = asString(first?.price);
  if (priceId) return priceId;
  return asString(body.price);
}

function expandSuccessUrl(template: string, sessionId: string): string {
  return template.replace(/\{CHECKOUT_SESSION_ID\}/g, sessionId);
}

function renderCheckoutPage(cs: TwinCheckoutSession, twinOrigin: string): string {
  const priceMeta = lookupPrice(cs.priceId);
  const label = priceMeta ? `${priceMeta.productName} — $${(priceMeta.unitAmount / 100).toFixed(0)}/mo` : cs.priceId;
  const completeUrl = `${twinOrigin}/checkout/${cs.id}/complete`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Twin Checkout · ${cs.id}</title>
<style>
body{margin:0;font:16px system-ui,sans-serif;background:#f9fafb;color:#111827;}
main{max-width:420px;margin:48px auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);}
h1{font-size:18px;margin:0 0 8px;}
p{color:#6b7280;font-size:14px;margin:0 0 16px;}
form{margin:0;}
button{display:block;width:100%;padding:12px 16px;background:#111827;color:#fff;border:0;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;}
.note{margin-top:16px;font-size:12px;color:#9ca3af;}
</style>
</head>
<body>
<main>
<h1>Twin Checkout</h1>
<p>${label}</p>
<form method="post" action="${completeUrl}">
<button type="submit">Pay (twin)</button>
</form>
<p class="note">Session: ${cs.id}. This is a simulator — no card collected.</p>
</main>
</body>
</html>`;
}

export type CompleteResult = { ok: true; session: TwinCheckoutSession } | { ok: false; reason: 'not_found' | 'already_complete' };

export function completeCheckoutSession(
  state: TwinState,
  cfg: WebhookConfig,
  sessionId: string,
): CompleteResult {
  const cs = state.checkoutSessions.get(sessionId);
  if (!cs) return { ok: false, reason: 'not_found' };
  if (cs.status === 'complete') return { ok: false, reason: 'already_complete' };

  const sub = buildSubscription(state, cs.customer, cs.priceId, cs.metadata);
  cs.subscriptionId = sub.id;
  cs.status = 'complete';
  state.checkoutSessions.set(cs.id, cs);

  const event = recordEvent(state, 'checkout.session.completed', {
    id: cs.id,
    object: 'checkout.session',
    customer: cs.customer,
    subscription: sub.id,
    mode: 'subscription',
    payment_status: 'paid',
    status: 'complete',
    metadata: cs.metadata,
    current_period_end: sub.currentPeriodEnd,
  });
  void deliverEvent(cfg, event);

  const subEvent = recordEvent(
    state,
    'customer.subscription.created',
    serializeSubscription(sub),
  );
  void deliverEvent(cfg, subEvent);

  return { ok: true, session: cs };
}

export function registerCheckout(
  app: FastifyInstance,
  state: TwinState,
  cfg: WebhookConfig,
  getTwinOrigin: () => string,
): void {
  app.post('/v1/checkout/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const customerId = asString(body.customer);
    if (!customerId || !state.customers.has(customerId)) {
      return reply
        .code(400)
        .send({ error: { type: 'invalid_request_error', message: 'customer required' } });
    }
    const priceId = pickPriceId(body);
    if (!priceId) {
      return reply
        .code(400)
        .send({ error: { type: 'invalid_request_error', message: 'price required' } });
    }
    const successUrl = asString(body.success_url) ?? '';
    const cancelUrl = asString(body.cancel_url) ?? '';
    const id = state.ids.next('cs');
    const cs: TwinCheckoutSession = {
      id,
      customer: customerId,
      priceId,
      successUrl: expandSuccessUrl(successUrl, id),
      cancelUrl,
      metadata: asMetadata(body.metadata),
      status: 'open',
      subscriptionId: null,
      created: Math.floor(Date.now() / 1000),
    };
    state.checkoutSessions.set(id, cs);
    const hostedUrl = `${getTwinOrigin()}/checkout/${id}`;
    return reply.code(200).send(serializeCheckoutSession(cs, hostedUrl));
  });

  app.get<{ Params: { id: string } }>('/v1/checkout/sessions/:id', async (req, reply) => {
    const cs = state.checkoutSessions.get(req.params.id);
    if (!cs) {
      return reply
        .code(404)
        .send({ error: { type: 'invalid_request_error', message: 'No such checkout session' } });
    }
    const hostedUrl = `${getTwinOrigin()}/checkout/${cs.id}`;
    return reply.code(200).send(serializeCheckoutSession(cs, hostedUrl));
  });

  app.get<{ Params: { id: string }; Querystring: { auto?: string } }>(
    '/checkout/:id',
    async (req, reply) => {
      const cs = state.checkoutSessions.get(req.params.id);
      if (!cs) return reply.code(404).type('text/plain').send('Unknown checkout session');
      if (req.query.auto === '1') {
        const result = completeCheckoutSession(state, cfg, cs.id);
        if (result.ok) return reply.redirect(result.session.successUrl, 302);
        if (result.reason === 'already_complete') return reply.redirect(cs.successUrl, 302);
        return reply.code(404).type('text/plain').send('Unknown checkout session');
      }
      return reply.code(200).type('text/html').send(renderCheckoutPage(cs, getTwinOrigin()));
    },
  );

  app.post<{ Params: { id: string } }>('/checkout/:id/complete', async (req, reply) => {
    const result = completeCheckoutSession(state, cfg, req.params.id);
    if (!result.ok) {
      if (result.reason === 'already_complete') {
        const existing = state.checkoutSessions.get(req.params.id);
        if (existing) return reply.redirect(existing.successUrl, 302);
      }
      return reply.code(404).type('text/plain').send('Unknown checkout session');
    }
    return reply.redirect(result.session.successUrl, 302);
  });
}
