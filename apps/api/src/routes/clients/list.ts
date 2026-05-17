import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import type { ClientListResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { serializeClient } from './serialize.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type Query = { search?: string; limit?: string; offset?: string };

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseOffset(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export default async function listClientsRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/clients',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as Query;
      const search = (q.search ?? '').trim();
      const limit = parseLimit(q.limit);
      const offset = parseOffset(q.offset);
      const scoped = db.forTenant(auth.tenant.id);

      const where = search
        ? {
            deletedAt: null,
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
            ],
          }
        : { deletedAt: null };

      const [rows, total] = await Promise.all([
        scoped.client.findMany({
          where,
          orderBy: { name: 'asc' },
          take: limit,
          skip: offset,
        }),
        scoped.client.count({ where }),
      ]);

      const body: ClientListResponse = {
        clients: rows.map(serializeClient),
        total,
        limit,
        offset,
      };
      reply.send(body);
    },
  );
}
