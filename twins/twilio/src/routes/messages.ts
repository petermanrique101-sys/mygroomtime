import type { FastifyInstance } from 'fastify';
import type { TwinConfig } from '../app.js';
import { asString } from '../form-body.js';
import { serializeMessage } from '../serialize.js';
import type { TwinMessage, TwinState } from '../state.js';

export const IDEMPOTENCY_WINDOW_MS = 60_000;

type Params = { sid: string };

export function registerMessages(
  app: FastifyInstance,
  state: TwinState,
  cfg: TwinConfig,
): void {
  app.post<{ Params: Params }>(
    '/2010-04-01/Accounts/:sid/Messages.json',
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const accountSid = req.params.sid;
      const from = asString(body.From) ?? '';
      const to = asString(body.To) ?? '';
      const text = asString(body.Body) ?? '';
      const statusCallback = asString(body.StatusCallback) ?? null;

      if (from.length === 0 || to.length === 0 || text.length === 0) {
        return reply.code(400).send({
          code: 21604,
          message: 'A "From", "To", and "Body" parameter is required.',
          status: 400,
        });
      }
      if (from !== cfg.fromNumber) {
        return reply.code(400).send({
          code: 21606,
          message: `The From phone number ${from} is not a valid, SMS-capable inbound phone number or short code for your account.`,
          status: 400,
        });
      }

      // why: real Twilio is "best-effort idempotent on the wire" but accepts dupes; the
      // twin tightens this to make adapter tests deterministic — same (from, to, body)
      // inside the 60s window returns the same SID rather than queuing a second message.
      const key = `${from}|${to}|${text}`;
      const now = Date.now();
      const existing = state.idempotency.get(key);
      if (existing && now - existing.createdAtMs < IDEMPOTENCY_WINDOW_MS) {
        const prior = state.messages.find((m) => m.sid === existing.sid);
        if (prior) {
          return reply.code(201).send(serializeMessage(prior));
        }
      }

      const msg: TwinMessage = {
        sid: state.ids.next(),
        accountSid,
        from,
        to,
        body: text,
        direction: 'out',
        status: 'queued',
        statusCallback,
        dateCreated: new Date(now).toISOString(),
      };
      state.messages.push(msg);
      state.idempotency.set(key, { sid: msg.sid, createdAtMs: now });

      return reply.code(201).send(serializeMessage(msg));
    },
  );
}
