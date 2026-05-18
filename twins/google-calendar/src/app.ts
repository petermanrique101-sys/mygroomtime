import Fastify, { type FastifyInstance } from 'fastify';
import { TwinState } from './state.js';
import { registerOauth } from './routes/oauth.js';
import { registerCalendarList } from './routes/calendar-list.js';
import { registerEvents } from './routes/events.js';
import { registerWatch } from './routes/watch.js';
import { registerAdmin } from './routes/admin.js';

export type CreateAppOptions = {
  logger?: boolean;
  publicOrigin?: string;
};

export type TwinConfig = {
  publicOrigin: string;
};

export type TwinAppHandle = {
  app: FastifyInstance;
  state: TwinState;
  cfg: TwinConfig;
};

export function createApp(opts: CreateAppOptions = {}): TwinAppHandle {
  const app = Fastify({ logger: opts.logger ?? false });
  const state = new TwinState();
  const cfg: TwinConfig = {
    publicOrigin: opts.publicOrigin ?? 'http://localhost:4244',
  };

  // why: Google's OAuth endpoints accept application/x-www-form-urlencoded. Fastify has
  // no default parser for this type — we flatten to a string→string map (URLSearchParams
  // does the right thing for repeated keys: last wins).
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

  app.get('/healthz', async () => ({ status: 'ok' }));

  registerOauth(app, state, cfg);
  registerCalendarList(app, state);
  registerEvents(app, state);
  registerWatch(app, state);
  registerAdmin(app, state);

  return { app, state, cfg };
}
