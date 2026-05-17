import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { buildOkResponse, buildStatusOnly } from './response.js';

export type CreateAppOptions = {
  logger?: boolean;
};

type Query = { address?: string; key?: string };

const SENTINEL_ZERO = '__ZERO_RESULTS__';
const SENTINEL_OVER_LIMIT = '__OVER_QUERY_LIMIT__';
const SENTINEL_REQUEST_DENIED = '__REQUEST_DENIED__';
const SENTINEL_RATE_LIMIT = '__RATE_LIMIT_ME__';
const RATE_LIMIT_RETRY_AFTER_SEC = 60;

function sendRateLimited(reply: FastifyReply): void {
  reply.header('Retry-After', String(RATE_LIMIT_RETRY_AFTER_SEC));
  reply.code(429).send({
    status: 'OVER_QUERY_LIMIT',
    results: [],
    error_message: 'Rate limit exceeded.',
  });
}

function registerGeocode(app: FastifyInstance): void {
  app.get('/maps/api/geocode/json', async (req, reply) => {
    const q = req.query as Query;
    const address = typeof q.address === 'string' ? q.address : '';

    if (address.length === 0) {
      return reply.code(200).send(buildStatusOnly('INVALID_REQUEST', 'address is required.'));
    }

    if (address.includes(SENTINEL_RATE_LIMIT)) {
      return sendRateLimited(reply);
    }
    if (address.includes(SENTINEL_REQUEST_DENIED)) {
      return reply.code(200).send(buildStatusOnly('REQUEST_DENIED', 'This request was denied.'));
    }
    if (address.includes(SENTINEL_OVER_LIMIT)) {
      return reply
        .code(200)
        .send(buildStatusOnly('OVER_QUERY_LIMIT', 'You have exceeded your daily request quota.'));
    }
    if (address.includes(SENTINEL_ZERO)) {
      return reply.code(200).send(buildStatusOnly('ZERO_RESULTS'));
    }

    return reply.code(200).send(buildOkResponse(address));
  });
}

export function createApp(opts: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  app.get('/healthz', async () => ({ status: 'ok' }));
  registerGeocode(app);
  return app;
}
