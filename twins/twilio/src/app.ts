import Fastify, { type FastifyInstance } from 'fastify';
import { parseFormBody } from './form-body.js';
import { TwinState } from './state.js';
import { registerMessages, IDEMPOTENCY_WINDOW_MS } from './routes/messages.js';
import { registerInbound } from './routes/inbound.js';
import { registerAdmin } from './routes/admin.js';

export type CreateAppOptions = {
  logger?: boolean;
  authToken?: string;
  fromNumber?: string;
  inboundWebhookUrl?: string | null;
};

export type TwinConfig = {
  authToken: string;
  fromNumber: string;
  inboundWebhookUrl: string | null;
};

export type TwinAppHandle = {
  app: FastifyInstance;
  state: TwinState;
  cfg: TwinConfig;
  setInboundWebhookUrl: (url: string | null) => void;
};

export const TWIN_IDEMPOTENCY_WINDOW_MS = IDEMPOTENCY_WINDOW_MS;

export function createApp(opts: CreateAppOptions = {}): TwinAppHandle {
  const app = Fastify({ logger: opts.logger ?? false });
  const state = new TwinState();
  const cfg: TwinConfig = {
    authToken: opts.authToken ?? 'auth_twin_default',
    fromNumber: opts.fromNumber ?? '+15555550100',
    inboundWebhookUrl: opts.inboundWebhookUrl ?? null,
  };

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const parsed = typeof body === 'string' ? parseFormBody(body) : parseFormBody(String(body));
        done(null, parsed);
      } catch (err) {
        done(err as Error);
      }
    },
  );

  app.get('/healthz', async () => ({ status: 'ok' }));

  registerMessages(app, state, cfg);
  registerInbound(app, state, cfg);
  registerAdmin(app, state);

  return {
    app,
    state,
    cfg,
    setInboundWebhookUrl(url: string | null): void {
      cfg.inboundWebhookUrl = url;
    },
  };
}
