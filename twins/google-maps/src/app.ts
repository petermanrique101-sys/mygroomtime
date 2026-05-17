import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { parsePoints, type ParsedPoint } from './parse.js';
import {
  buildOkResponse,
  buildOverQueryLimitResponse,
  shouldOverLimit,
} from './response.js';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';

export type CreateAppOptions = {
  logger?: boolean;
  rateLimitPerSecond?: number | null;
};

const RATE_LIMIT_TRIGGER_LAT = -2.0;
const RATE_LIMIT_RETRY_AFTER_SEC = 60;

function triggers429(points: ParsedPoint[]): boolean {
  return points.some((p) => p.kind === 'latlng' && p.value.lat === RATE_LIMIT_TRIGGER_LAT);
}

function badRequest(reply: FastifyReply, message: string): void {
  reply.code(200).send({
    status: 'INVALID_REQUEST',
    error_message: message,
  });
}

function rateLimited(reply: FastifyReply, retryAfter: number): void {
  reply.header('Retry-After', String(retryAfter));
  reply.code(429).send({
    status: 'OVER_QUERY_LIMIT',
    error_message: 'Rate limit exceeded.',
  });
}

type Query = { origins?: string; destinations?: string; key?: string };

function registerDistanceMatrix(app: FastifyInstance, limiter: RateLimiter): void {
  app.get('/maps/api/distancematrix/json', async (req, reply) => {
    const q = req.query as Query;

    if (typeof q.origins !== 'string' || typeof q.destinations !== 'string') {
      return badRequest(reply, 'origins and destinations are required.');
    }
    if (typeof q.key !== 'string' || q.key.length === 0) {
      return badRequest(reply, 'key is required.');
    }

    const origins = parsePoints(q.origins);
    const destinations = parsePoints(q.destinations);
    if (origins.length === 0 || destinations.length === 0) {
      return badRequest(reply, 'origins and destinations must contain at least one point.');
    }

    if (triggers429(origins) || triggers429(destinations)) {
      return rateLimited(reply, RATE_LIMIT_RETRY_AFTER_SEC);
    }
    if (limiter.shouldThrottle()) {
      return rateLimited(reply, limiter.retryAfterSec());
    }

    if (shouldOverLimit(origins, destinations)) {
      return reply.code(200).send(buildOverQueryLimitResponse());
    }

    return reply.code(200).send(buildOkResponse(origins, destinations));
  });
}

export function createApp(opts: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const limiter = createRateLimiter(opts.rateLimitPerSecond ?? null);

  app.get('/healthz', async () => ({ status: 'ok' }));
  registerDistanceMatrix(app, limiter);

  return app;
}
