import type { Service } from '@mygroomtime/db';
import type { ServiceOutput } from '@mygroomtime/shared';

export function serializeService(s: Service): ServiceOutput {
  return {
    id: s.id,
    name: s.name,
    durationMin: s.durationMin,
    basePriceCents: s.basePriceCents,
    depositCents: s.depositCents,
    color: s.color,
    active: s.active,
    deletedAt: s.deletedAt ? s.deletedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
