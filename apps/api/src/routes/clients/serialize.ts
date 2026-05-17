import type { Client, Pet } from '@mygroomtime/db';
import type { ClientOutput, ClientWithPetsOutput, PetOutput } from '@mygroomtime/shared';

export function serializePet(p: Pet): PetOutput {
  return {
    id: p.id,
    clientId: p.clientId,
    name: p.name,
    breed: p.breed,
    weightLb: p.weightLb,
    coatType: p.coatType,
    temperamentNotes: p.temperamentNotes,
    preferredCutStyle: p.preferredCutStyle,
    vaccinationExpiry: p.vaccinationExpiry ? p.vaccinationExpiry.toISOString() : null,
    photoUrl: p.photoUrl,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function serializeClient(c: Client): ClientOutput {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    street: c.addressStreet,
    city: c.addressCity,
    state: c.addressState,
    zip: c.addressZip,
    lat: c.addressLat,
    lng: c.addressLng,
    addressVerified: c.addressVerified,
    preferredGroomerId: c.preferredGroomerId,
    notes: c.notes,
    smsOptOut: c.smsOptOut,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function serializeClientWithPets(c: Client, pets: Pet[]): ClientWithPetsOutput {
  return { ...serializeClient(c), pets: pets.map(serializePet) };
}
