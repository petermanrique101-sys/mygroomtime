import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dispatchEvent } from './dispatch.js';
import { recordIncomingEvent, markProcessed, markFailed } from './dedupe.js';

const STRIPE_SIG_HEADER = 'stripe-signature';

export default async function stripeWebhookRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/webhooks/stripe',
    { config: { rateLimit: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers[STRIPE_SIG_HEADER];
      if (typeof signature !== 'string' || signature.length === 0) {
        reply.code(400).send({ error: 'missing_signature' });
        return;
      }
      const raw = request.rawBody;
      if (!raw) {
        reply.code(400).send({ error: 'missing_body' });
        return;
      }
      let event;
      try {
        event = app.adapters.stripe.verifyWebhookSignature({
          payload: raw,
          signature,
          secret: app.appEnv.stripe.webhookSecret,
        });
      } catch (err) {
        request.log.warn({ err: (err as Error).message }, 'stripe webhook signature rejected');
        reply.code(400).send({ error: 'invalid_signature' });
        return;
      }

      const parsedRaw: unknown = JSON.parse(raw.toString('utf8'));
      const outcome = await recordIncomingEvent(event.id, parsedRaw);
      if (outcome.kind === 'duplicate') {
        reply.code(200).send({ deduped: true });
        return;
      }

      const result = await dispatchEvent(event);
      if (result.kind === 'ok') {
        await markProcessed(outcome.id);
        reply.code(200).send({ received: true });
        return;
      }
      if (result.kind === 'unhandled') {
        await markProcessed(outcome.id);
        request.log.info({ rawType: result.rawType }, 'stripe webhook unhandled event type');
        reply.code(200).send({ ignored: result.rawType });
        return;
      }
      const message =
        result.kind === 'handler_error'
          ? result.reason
          : `${result.error.name}: ${result.error.message}`;
      const { deadLetter } = await markFailed(outcome.id, message);
      request.log.error({ message, deadLetter }, 'stripe webhook handler failed');
      reply.code(500).send({ error: 'handler_failed' });
    },
  );
}
