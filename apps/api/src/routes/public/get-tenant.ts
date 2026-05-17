import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import type {
  PublicTenantResponse,
  PublicTenantService,
} from '@mygroomtime/shared';
import { resolvePublicTenant } from '../../middleware/resolve-public-tenant.js';
import { publicRateLimitConfig } from './rate-limit.js';

export default async function getPublicTenantRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/public/:slug',
    {
      config: { rateLimit: publicRateLimitConfig() },
      preHandler: [resolvePublicTenant],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.publicTenant!;
      const scoped = db.forTenant(tenant.id);
      const rows = await scoped.service.findMany({
        where: { active: true, deletedAt: null },
        orderBy: { name: 'asc' },
      });
      const services: PublicTenantService[] = rows.map((s) => ({
        id: s.id,
        name: s.name,
        durationMin: s.durationMin,
        basePriceCents: s.basePriceCents,
        depositCents: s.depositCents,
        color: s.color,
      }));
      const body: PublicTenantResponse = {
        slug: tenant.slug,
        businessName: tenant.businessName,
        phone: tenant.phone,
        readOnly: request.publicTenantReadOnly === true,
        currentTime: new Date().toISOString(),
        services,
      };
      reply.header('Cache-Control', 'private, max-age=30');
      reply.send(body);
    },
  );
}
