import type { Redis } from 'ioredis';
import type { AppUserRow, AppTenantRow } from '../auth/session.js';
import type { SessionStore } from '../adapters/session/index.js';
import type { EmailAdapter } from '../adapters/email/index.js';
import type { Adapters } from '../adapters/index.js';
import type { AppEnv } from '../config/env.js';
import type { ReminderQueue, ReminderWorker } from '../queue/connection.js';
import type {
  MaterializeQueue,
  MaterializeWorker,
} from '../queue/materialize-connection.js';
import type {
  GcalPullQueue,
  GcalPushQueue,
  GcalRenewQueue,
} from '../queue/gcal-connection.js';
import type { MutationContext } from '../middleware/mutation-dedupe.js';

declare module 'fastify' {
  interface FastifyInstance {
    appEnv: AppEnv;
    adapters: Adapters;
    sessionStore: SessionStore;
    emailAdapter: EmailAdapter;
    reminderQueue: ReminderQueue | null;
    reminderWorker: ReminderWorker | null;
    materializeQueue: MaterializeQueue | null;
    materializeWorker: MaterializeWorker | null;
    gcalPushQueue: GcalPushQueue | null;
    gcalPullQueue: GcalPullQueue | null;
    gcalRenewQueue: GcalRenewQueue | null;
    gcalRedis: Redis | null;
  }
  interface FastifyRequest {
    auth?: {
      user: AppUserRow;
      tenant: AppTenantRow;
      sid: string;
    };
    rawBody?: Buffer;
    mutation?: MutationContext;
  }
}
