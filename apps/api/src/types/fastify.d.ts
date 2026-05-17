import type { AppUserRow, AppTenantRow } from '../auth/session.js';
import type { SessionStore } from '../adapters/session/index.js';
import type { EmailAdapter } from '../adapters/email/index.js';
import type { Adapters } from '../adapters/index.js';
import type { AppEnv } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    appEnv: AppEnv;
    adapters: Adapters;
    sessionStore: SessionStore;
    emailAdapter: EmailAdapter;
  }
  interface FastifyRequest {
    auth?: {
      user: AppUserRow;
      tenant: AppTenantRow;
      sid: string;
    };
    rawBody?: Buffer;
  }
}
