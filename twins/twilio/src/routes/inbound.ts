import type { FastifyInstance } from 'fastify';
import type { TwinConfig } from '../app.js';
import { asString } from '../form-body.js';
import type { TwinMessage, TwinState } from '../state.js';
import { signInboundWebhook } from '../sign.js';

type InboundBody = {
  from?: string;
  to?: string;
  body?: string;
  url?: string;
};

export function registerInbound(
  app: FastifyInstance,
  state: TwinState,
  cfg: TwinConfig,
): void {
  app.post('/__twin_inbound', async (req, reply) => {
    const body = (req.body ?? {}) as InboundBody;
    const from = body.from?.trim();
    const to = body.to?.trim() ?? cfg.fromNumber;
    const text = body.body;
    const targetUrl = body.url ?? cfg.inboundWebhookUrl;

    if (!from || !text) {
      return reply.code(400).send({ error: 'from and body required' });
    }
    if (!targetUrl) {
      return reply.code(400).send({ error: 'no inbound webhook url configured' });
    }

    const sid = state.ids.nextInbound();
    const msg: TwinMessage = {
      sid,
      accountSid: 'AC_TWIN',
      from,
      to,
      body: text,
      direction: 'in',
      status: 'delivered',
      statusCallback: null,
      dateCreated: new Date().toISOString(),
    };
    state.messages.push(msg);

    const formParams: Record<string, string> = {
      MessageSid: sid,
      AccountSid: 'AC_TWIN',
      From: from,
      To: to,
      Body: text,
      NumMedia: '0',
      SmsStatus: 'received',
    };
    const signature = signInboundWebhook(cfg.authToken, targetUrl, formParams);
    const formBody = new URLSearchParams(formParams).toString();

    let deliveryStatus = 0;
    let deliveryError: string | null = null;
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': signature,
        },
        body: formBody,
      });
      deliveryStatus = res.status;
      if (res.status < 200 || res.status >= 300) {
        deliveryError = await res.text();
      }
    } catch (err) {
      deliveryError = (err as Error).message;
    }

    return reply.code(200).send({
      sid,
      delivery: { status: deliveryStatus, error: deliveryError },
    });
  });

  app.get('/__twin_messages', async () => {
    return { messages: state.messages };
  });

  // why: chunk-22 operator log will want to filter by direction; expose a tiny query for tests.
  app.get<{ Querystring: { direction?: string } }>(
    '/__twin_messages/by-direction',
    async (req) => {
      const dir = asString(req.query.direction);
      const filtered =
        dir === 'out' || dir === 'in'
          ? state.messages.filter((m) => m.direction === dir)
          : state.messages;
      return { messages: filtered };
    },
  );
}
