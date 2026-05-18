import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import type { HealthCheck } from '@mygroomtime/shared';
import { loadEnv, type AppEnv } from './config/env.js';
import type { SessionStore } from './adapters/session/index.js';
import type { EmailAdapter } from './adapters/email/index.js';
import { createAdapters, type Adapters } from './adapters/index.js';
import authRoutes from './routes/auth/index.js';
import probeRoutes from './routes/probe.js';
import clientRoutes from './routes/clients/index.js';
import serviceRoutes from './routes/services/index.js';
import appointmentRoutes from './routes/appointments/index.js';
import billingRoutes from './routes/billing/index.js';
import publicRoutes from './routes/public/index.js';
import settingsRoutes from './routes/settings/index.js';
import stripeWebhookRoute from './routes/webhooks/stripe/index.js';

export type CreateAppOptions = {
  logger?: boolean;
  env?: AppEnv;
  sessionStore?: SessionStore;
  emailAdapter?: EmailAdapter;
  adapters?: Partial<Adapters>;
};

const PII_REDACT_PATHS = [
  'req.body.password',
  'req.body.email',
  'req.body.token',
  'req.body.phone',
  'req.body.street',
  'req.body.city',
  'req.body.zip',
  'req.body.notes',
  'req.body.data',
  'req.body.customer',
  'req.body.pet',
  'req.body.firstName',
  'req.body.lastName',
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
];

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

export async function createApp(opts: CreateAppOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();

  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            redact: { paths: PII_REDACT_PATHS, censor: '[redacted]' },
          },
  });

  const adapters = createAdapters(env, {
    ...opts.adapters,
    ...(opts.sessionStore ? { session: opts.sessionStore } : {}),
    ...(opts.emailAdapter ? { email: opts.emailAdapter } : {}),
  });

  app.decorate('appEnv', env);
  app.decorate('adapters', adapters);
  app.decorate('sessionStore', adapters.session);
  app.decorate('emailAdapter', adapters.email);

  app.addHook('onClose', async () => {
    await adapters.session.close();
  });

  // why: webhook handlers verify Stripe signatures over the raw bytes. The default JSON
  // parser discards the buffer, so we replace it with one that stashes it on req.rawBody.
  // All other JSON routes keep their normal parsed body.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body as unknown as string);
      (req as RawBodyRequest).rawBody = buf;
      if (buf.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(buf.toString('utf8')));
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        e.statusCode = 400;
        done(e);
      }
    },
  );

  await app.register(fastifyCors, {
    origin: env.webOrigin,
    credentials: true,
  });
  await app.register(fastifyCookie, { secret: env.cookieSecret });
  await app.register(fastifyRateLimit, {
    global: false,
    max: 10,
    timeWindow: '1 minute',
  });

  app.get('/healthz', async (): Promise<HealthCheck> => ({ status: 'ok' }));

  await app.register(authRoutes);
  await app.register(probeRoutes);
  await app.register(clientRoutes);
  await app.register(serviceRoutes);
  await app.register(appointmentRoutes);
  await app.register(billingRoutes);
  await app.register(settingsRoutes);
  await app.register(publicRoutes);
  await app.register(stripeWebhookRoute);

  return app;
}
