import type { Service, TenantScopedDb } from '@mygroomtime/db';

export async function findActiveService(
  scoped: TenantScopedDb,
  id: string,
): Promise<Service | null> {
  return scoped.service.findFirst({ where: { id, deletedAt: null } });
}

export async function findAnyService(
  scoped: TenantScopedDb,
  id: string,
): Promise<Service | null> {
  return scoped.service.findFirst({ where: { id } });
}
