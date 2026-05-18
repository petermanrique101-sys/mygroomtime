import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  db,
  isUniqueViolation,
  SmsDirection,
  SmsStatus,
  WebhookProcessingStatus,
  WebhookSource,
} from '@mygroomtime/db';
import { tenDigitSuffix } from '../../../services/phone.js';

const TWILIO_SIG_HEADER = 'x-twilio-signature';

// why: Twilio's canonical list of STOP keywords + the "yes I'd like to receive again"
// counterpart. Comparison is case-insensitive on a trimmed body.
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_WORDS = new Set(['START', 'UNSTOP', 'YES']);

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
  // why: Twilio signs the *exact URL it POSTed to*. In production we trust the
  // X-Forwarded-Proto/Host that the load balancer sets; in dev the request URL is
  // already what the twin used to sign. Fall back to request.protocol/hostname.
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

      // 1. dedupe by MessageSid via the shared WebhookEvent table (chunk-10 pattern).
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

      // 2. match Clients by phone (10-digit suffix) across all tenants. A single phone
      //    can map to clients at multiple tenants (one human, two groomers); STOP/START
      //    should hit all of them so the application-level opt-out is consistent with
      //    Twilio's carrier-level auto-unsubscribe (also per-number, not per-business).
      const suffix = tenDigitSuffix(from);
      const matches =
        suffix.length === 10
          ? await db.global.tenant.findMany({
              where: {
                clients: {
                  some: { phone: { endsWith: suffix }, deletedAt: null },
                },
              },
              select: {
                id: true,
                clients: {
                  where: { phone: { endsWith: suffix }, deletedAt: null },
                  select: { id: true },
                },
              },
            })
          : [];

      if (matches.length === 0) {
        request.log.info(
          { messageSid },
          'twilio inbound: no client matched the From number; ignoring',
        );
        reply.code(200).send({ ok: true, matched: false });
        return;
      }

      const normalized = body.trim().toUpperCase();
      const isStop = STOP_WORDS.has(normalized);
      const isStart = START_WORDS.has(normalized);

      for (const tenant of matches) {
        const scoped = db.forTenant(tenant.id);
        for (const c of tenant.clients) {
          if (isStop) {
            await scoped.client.update({
              where: { id: c.id },
              data: { smsOptOut: true, smsOptOutAt: new Date() },
            });
          } else if (isStart) {
            await scoped.client.update({
              where: { id: c.id },
              data: { smsOptOut: false, smsOptOutAt: null },
            });
          }
          // 3. always log inbound to SmsMessage per matched client. status=sent because
          //    it actually arrived; the row records what came in, not delivery state.
          //    twilioSid stays null on inbound rows — Twilio's MessageSid lives on the
          //    WebhookEvent row (above) for dedupe, and the unique constraint on
          //    twilioSid would otherwise collide if one inbound matches two clients.
          await scoped.smsMessage.create({
            data: {
              clientId: c.id,
              direction: SmsDirection.in,
              toE164: to,
              fromE164: from,
              body,
              status: SmsStatus.sent,
            },
          });
        }
      }

      reply.code(200).send({ ok: true, matched: true });
    },
  );
}
