import type { TenantScopedDb } from '@mygroomtime/db';
import type { Client, Pet } from '@mygroomtime/db';

export async function findActiveClient(
  scoped: TenantScopedDb,
  id: string,
): Promise<Client | null> {
  return scoped.client.findFirst({ where: { id, deletedAt: null } });
}

export async function findActivePets(
  scoped: TenantScopedDb,
  clientId: string,
): Promise<Pet[]> {
  return scoped.pet.findMany({
    where: { clientId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
}

export async function findActivePet(
  scoped: TenantScopedDb,
  clientId: string,
  petId: string,
): Promise<Pet | null> {
  return scoped.pet.findFirst({ where: { id: petId, clientId, deletedAt: null } });
}
