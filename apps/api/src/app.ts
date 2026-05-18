import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import type { Redis } from 'ioredis';
import type { HealthCheck } from '@mygroomtime/shared';
import { loadEnv, type AppEnv } from './config/env.js';
import type { SessionStore } from './adapters/session/index.js';
import type { EmailAdapter } from './adapters/email/index.js';
import { createAdapters, type Adapters } from './adapters/index.js';
import {
  closeReminderInfra,
  createReminderQueue,
  createReminderRedis,
  createReminderWorker,
  type ReminderQueue,
  type ReminderWorker,
} from './queue/connection.js';
import { createReminderHandler } from './queue/reminder-worker.js';
import {
  closeMaterializeInfra,
  createMaterializeQueue,
  createMaterializeWorker,
  type MaterializeQueue,
  type MaterializeWorker,
} from './queue/materialize-connection.js';
import { createMaterializeHandler } from './queue/materialize-worker.js';
import { MATERIALIZE_JOB_NAME } from './queue/queue-names.js';
import {
  buildGcalInfra,
  closeGcalInfraInline,
  type GcalInfra,
} from './queue/gcal-infra.js';
import {
  captureMutationPayload,
  persistMutationLog,
} from './middleware/mutation-dedupe.js';
import authRoutes from './routes/auth/index.js';
import probeRoutes from './routes/probe.js';
import clientRoutes from './routes/clients/index.js';
import serviceRoutes from './routes/services/index.js';
import appointmentRoutes from './routes/appointments/index.js';
import billingRoutes from './routes/billing/index.js';
import publicRoutes from './routes/public/index.js';
import settingsRoutes from './routes/settings/index.js';
import stripeWebhookRoute from './routes/webhooks/stripe/index.js';
import twilioWebhookRoute from './routes/webhooks/twilio/index.js';
import gcalWebhookRoute from './routes/webhooks/google-calendar.js';
import recurringSeriesRoutes from './routes/recurring-series/index.js';
import dashboardRoutes from './routes/dashboard/index.js';
import vehicleRoutes from './routes/vehicles/index.js';
import payrollRoutes from './routes/payroll/index.js';

export type ReminderInfra = {
  queue: ReminderQueue;
  worker: ReminderWorker | null;
  connection: Redis | null;
};

export type MaterializeInfra = {
  queue: MaterializeQueue;
  worker: MaterializeWorker | null;
  connection: Redis | null;
};

export type { GcalInfra } from './queue/gcal-infra.js';

export type CreateAppOptions = {
  logger?: boolean;
  env?: AppEnv;
  sessionStore?: SessionStore;
  emailAdapter?: EmailAdapter;
  adapters?: Partial<Adapters>;
  reminderInfra?: ReminderInfra | null;
  materializeInfra?: MaterializeInfra | null;
  gcalInfra?: GcalInfra | null;
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
  'req.body.From',
  'req.body.To',
  'req.body.Body',
  'req.body.toE164',
  'req.body.fromE164',
  'req.body.body',
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["stripe-signature"]',
  'req.headers["x-twilio-signature"]',
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

  // why: caller can pre-construct the queue (chunk-15 tests do this with the dev Redis
  // container) or pass `null` to skip the worker entirely. Tests that don't exercise the
  // queue default to null so they don't open Redis sockets to a non-existent host.
  // In production startup, opts.reminderInfra is undefined and we build a live queue+worker
  // against env.redisUrl.
  let reminderInfra: ReminderInfra | null;
  if (opts.reminderInfra === null) {
    reminderInfra = null;
  } else if (opts.reminderInfra) {
    reminderInfra = opts.reminderInfra;
  } else if (env.nodeEnv === 'test') {
    reminderInfra = null;
  } else {
    const connection = createReminderRedis(env.redisUrl);
    const queue = createReminderQueue(connection);
    const worker = createReminderWorker(
      createReminderRedis(env.redisUrl),
      createReminderHandler({ twilio: adapters.twilio, log: app.log }),
    );
    reminderInfra = { queue, worker, connection };
  }

  if (reminderInfra) {
    app.decorate('reminderQueue', reminderInfra.queue);
    app.decorate('reminderWorker', reminderInfra.worker);
  } else {
    app.decorate('reminderQueue', null);
    app.decorate('reminderWorker', null);
  }

  // why: gcal infra mirrors reminder/materialize. Three queues — push, pull, renew. Tests
  // can pass `gcalInfra: null` to skip Redis sockets entirely. Built before materialize so
  // the materialize handler can pass gcalInfra.pushQueue through.
  let gcalInfra: GcalInfra | null;
  if (opts.gcalInfra === null) {
    gcalInfra = null;
  } else if (opts.gcalInfra) {
    gcalInfra = opts.gcalInfra;
  } else if (env.nodeEnv === 'test') {
    gcalInfra = null;
  } else {
    gcalInfra = await buildGcalInfra({
      env,
      adapters,
      reminderQueue: reminderInfra?.queue ?? null,
      log: app.log,
    });
  }

  if (gcalInfra) {
    app.decorate('gcalPushQueue', gcalInfra.pushQueue);
    app.decorate('gcalPullQueue', gcalInfra.pullQueue);
    app.decorate('gcalRenewQueue', gcalInfra.renewQueue);
    app.decorate('gcalRedis', gcalInfra.cacheRedis);
  } else {
    app.decorate('gcalPushQueue', null);
    app.decorate('gcalPullQueue', null);
    app.decorate('gcalRenewQueue', null);
    app.decorate('gcalRedis', null);
  }

  // why: materialize infra mirrors reminder infra. Tests skip it by default unless they
  // need to exercise the nightly walk. In production startup we build a live queue+worker
  // and register a BullMQ repeat (nightly at 02:00 UTC) so the walk fires without a
  // separate cron container.
  let materializeInfra: MaterializeInfra | null;
  if (opts.materializeInfra === null) {
    materializeInfra = null;
  } else if (opts.materializeInfra) {
    materializeInfra = opts.materializeInfra;
  } else if (env.nodeEnv === 'test') {
    materializeInfra = null;
  } else {
    const matConnection = createReminderRedis(env.redisUrl);
    const matQueue = createMaterializeQueue(matConnection);
    const matWorker = createMaterializeWorker(
      createReminderRedis(env.redisUrl),
      createMaterializeHandler({
        gmaps: adapters.gmaps,
        reminderQueue: reminderInfra?.queue ?? null,
        gcalPushQueue: gcalInfra?.pushQueue ?? null,
        log: app.log,
      }),
    );
    materializeInfra = { queue: matQueue, worker: matWorker, connection: matConnection };

    // why: nightly repeat at 02:00 UTC. BullMQ dedupes the repeatable job by its name +
    // cron pattern, so app restarts don't pile up duplicate schedulers.
    await matQueue.add(
      MATERIALIZE_JOB_NAME,
      { tick: Date.now() },
      { repeat: { pattern: '0 2 * * *' }, removeOnComplete: 100, removeOnFail: 100 },
    );
  }

  if (materializeInfra) {
    app.decorate('materializeQueue', materializeInfra.queue);
    app.decorate('materializeWorker', materializeInfra.worker);
  } else {
    app.decorate('materializeQueue', null);
    app.decorate('materializeWorker', null);
  }

  app.addHook('onClose', async () => {
    await adapters.session.close();
    if (reminderInfra) {
      await closeReminderInfra(
        reminderInfra.worker,
        reminderInfra.queue,
        reminderInfra.connection,
      );
    }
    if (materializeInfra) {
      await closeMaterializeInfra(
        materializeInfra.worker,
        materializeInfra.queue,
        materializeInfra.connection,
      );
    }
    if (gcalInfra) {
      await closeGcalInfraInline(gcalInfra);
    }
  });

  // why: webhook handlers verify Stripe signatures over the raw bytes. The default JSON
  // parser discards the buffer, so we replace it with one that stashes it on req.rawBody.
  // All other JSON routes keep their normal parsed body.
  // why: Twilio's inbound webhook is application/x-www-form-urlencoded. Fastify has no
  // default parser for this content type. We parse to a flat string→string map (Twilio
  // never sends nested keys) so the route handler can compute the signature base over
  // the same shape Twilio used to sign it.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      const raw = typeof body === 'string' ? body : String(body);
      const out: Record<string, string> = {};
      try {
        for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
        done(null, out);
      } catch (err) {
        done(err as Error);
      }
    },
  );

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

  // why: chunk 18 — capture the response body in onSend (sync, no await) and persist the
  // MutationLog row in onResponse (after the wire is closed). Both hooks are no-ops when
  // request.mutation is absent.
  app.addHook('onSend', (request, reply, payload, done) => {
    captureMutationPayload(request, reply, payload);
    done(null, payload);
  });
  app.addHook('onResponse', async (request, reply) => {
    await persistMutationLog(request, reply);
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
  await app.register(twilioWebhookRoute);
  await app.register(gcalWebhookRoute);
  await app.register(recurringSeriesRoutes);
  await app.register(dashboardRoutes);
  await app.register(vehicleRoutes);
  await app.register(payrollRoutes);

  return app;
}
