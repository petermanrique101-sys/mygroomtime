import type {
  ClientCreateRequest,
  ClientListResponse,
  ClientMutationResponse,
  ClientUpdate,
  ClientWithPetsOutput,
  PetInput,
  PetOutput,
  PetUpdate,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function listClients(search?: string): Promise<Result<ClientListResponse>> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiFetch<ClientListResponse>(`/clients${qs}`);
}

export async function getClient(id: string): Promise<Result<{ client: ClientWithPetsOutput }>> {
  return apiFetch<{ client: ClientWithPetsOutput }>(`/clients/${id}`);
}

export async function createClient(
  payload: ClientCreateRequest,
): Promise<Result<ClientMutationResponse>> {
  return apiFetch<ClientMutationResponse>('/clients', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateClient(
  id: string,
  payload: ClientUpdate,
): Promise<Result<ClientMutationResponse>> {
  return apiFetch<ClientMutationResponse>(`/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteClient(id: string): Promise<Result<void>> {
  return apiFetch<void>(`/clients/${id}`, { method: 'DELETE' });
}

export async function addPet(
  clientId: string,
  payload: PetInput,
): Promise<Result<{ pet: PetOutput }>> {
  return apiFetch<{ pet: PetOutput }>(`/clients/${clientId}/pets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updatePet(
  clientId: string,
  petId: string,
  payload: PetUpdate,
): Promise<Result<{ pet: PetOutput }>> {
  return apiFetch<{ pet: PetOutput }>(`/clients/${clientId}/pets/${petId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deletePet(clientId: string, petId: string): Promise<Result<void>> {
  return apiFetch<void>(`/clients/${clientId}/pets/${petId}`, { method: 'DELETE' });
}
