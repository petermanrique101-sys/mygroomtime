import type { FastifyRequest } from 'fastify';

const MAX_PER_MINUTE = 60;

// why: public endpoints are anonymous, so the limit key is the requesting IP. We mix the
// slug in so a single bad actor scraping one tenant doesn't impact rate limits for the
// same IP visiting another tenant's page.
function keyGenerator(req: FastifyRequest): string {
  const slug = (req.params as { slug?: string }).slug ?? '';
  return `${req.ip}::${slug}`;
}

export function publicRateLimitConfig(): {
  max: number;
  timeWindow: string;
  keyGenerator: (req: FastifyRequest) => string;
} {
  return {
    max: MAX_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator,
  };
}
