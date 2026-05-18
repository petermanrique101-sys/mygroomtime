import type { User, Vehicle } from '@mygroomtime/db';
import type { VehicleOutput } from '@mygroomtime/shared';

export type VehicleWithGroomer = Vehicle & {
  assignedGroomer: Pick<User, 'id' | 'name' | 'email'> | null;
};

export function serializeVehicle(v: VehicleWithGroomer): VehicleOutput {
  return {
    id: v.id,
    name: v.name,
    assignedGroomerId: v.assignedGroomerId,
    assignedGroomerName: v.assignedGroomer?.name ?? null,
    assignedGroomerEmail: v.assignedGroomer?.email ?? null,
    active: v.active,
    deletedAt: v.deletedAt ? v.deletedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}
