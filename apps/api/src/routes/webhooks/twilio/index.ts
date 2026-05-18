import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  db,
  isUniqueViolation,
  WebhookProcessingStatus,
  WebhookSource,
} from '@mygroomtime/db';
import { dispatchInbound } from '../../../services/inbound-sms-dispatch.js';

const TWILIO_SIG_HEADER = 'x-twilio-signature';

type TwilioInboundForm = {
  MessageSid?: string;
  AccountSid?: string;
  From?: string;
  To?: string;
  Body?: string;
};

function asTwilioForm(body: unknown): TwilioInboundForm {
  if (!body || typeof body !== 'object') return {};
  return body as TwilioInboundForm;
}

function reconstructUrl(request: FastifyRequest): string {
  // why: Twilio signs the exact URL it POSTed to. In production we trust the
  // X-Forwarded-Proto/Host the load balancer sets; in dev the request URL is already
  // what the twin used to sign.
  const proto =
    (request.headers['x-forwarded-proto'] as string | undefined) ?? request.protocol;
  const host = (request.headers['x-forwarded-host'] as string | undefined) ?? request.hostname;
  return `${proto}://${host}${request.url}`;
}

export default async function twilioWebhookRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/webhooks/twilio',
    { config: { rateLimit: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers[TWILIO_SIG_HEADER];
      if (typeof signature !== 'string' || signature.length === 0) {
        reply.code(400).send({ error: 'missing_signature' });
        return;
      }
      const form = asTwilioForm(request.body);
      const stringParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) {
        if (typeof v === 'string') stringParams[k] = v;
      }

      const url = reconstructUrl(request);
      const valid = app.adapters.twilio.verifyWebhookSignature({
        url,
        params: stringParams,
        signature,
      });
      if (!valid) {
        request.log.warn({ url }, 'twilio webhook signature rejected');
        reply.code(400).send({ error: 'invalid_signature' });
        return;
      }

      const messageSid = form.MessageSid;
      const from = form.From;
      const to = form.To;
      const body = form.Body ?? '';
      if (!messageSid || !from || !to) {
        reply.code(400).send({ error: 'missing_required_fields' });
        return;
      }

      // dedupe by MessageSid via the shared WebhookEvent table (chunk-10 pattern).
      try {
        await db.global.webhookEvent.create({
          data: {
            source: WebhookSource.twilio,
            eventId: messageSid,
            payload: stringParams as object,
            status: WebhookProcessingStatus.processed,
            processedAt: new Date(),
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          reply.code(200).send({ deduped: true });
          return;
        }
        throw err;
      }

      const outcome = await dispatchInbound(
        { from, to, body, messageSid },
        {
          twilio: app.adapters.twilio,
          sessionStore: app.adapters.session,
          rescheduleTokenSecret: app.appEnv.rescheduleTokenSecret,
          webOrigin: app.appEnv.webOrigin,
          log: request.log,
        },
      );

      reply.code(200).send({
        ok: true,
        action: outcome.action,
        matched: outcome.matchedTenantIds.length > 0,
      });
    },
  );
}
