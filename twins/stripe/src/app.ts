import Fastify, { type FastifyInstance } from 'fastify';
import { TwinState } from './state.js';
import { parseFormBody } from './form-body.js';
import { registerCustomers } from './routes/customers.js';
import { registerAccounts } from './routes/accounts.js';
import { registerSubscriptions } from './routes/subscriptions.js';
import { registerCheckout } from './routes/checkout.js';
import { registerPaymentIntents, registerRefunds } from './routes/payment-intents.js';
import { registerAdmin } from './routes/admin.js';
import type { WebhookConfig } from './webhook.js';

export type CreateAppOptions = {
  logger?: boolean;
  webhookUrl?: string | null;
  webhookSecret?: string;
  publicOrigin?: string;
};

export type TwinAppHandle = {
  app: FastifyInstance;
  state: TwinState;
  cfg: WebhookConfig;
  setPublicOrigin: (origin: string) => void;
};

export function createApp(opts: CreateAppOptions = {}): TwinAppHandle {
  const app = Fastify({ logger: opts.logger ?? false });
  const state = new TwinState();
  const cfg: WebhookConfig = {
    url: opts.webhookUrl ?? null,
    secret: opts.webhookSecret ?? 'whsec_twin_default',
  };

  let publicOrigin = opts.publicOrigin ?? 'http://localhost:4242';
  const getOrigin = (): string => publicOrigin;

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

  registerCustomers(app, state);
  registerAccounts(app, state);
  registerSubscriptions(app, state, cfg);
  registerCheckout(app, state, cfg, getOrigin);
  registerPaymentIntents(app, state, cfg);
  registerRefunds(app, state, cfg);
  registerAdmin(app, state, cfg);

  return {
    app,
    state,
    cfg,
    setPublicOrigin(origin: string): void {
      publicOrigin = origin;
    },
  };
}
