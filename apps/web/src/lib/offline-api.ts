import { uuidv7 } from './uuid-v7';
import { enqueue, type QueuedMutation } from './offline-queue';
import { notifyOfflineQueueChanged } from './offline-bus';
import { requestBackgroundSync } from './sw-bridge';
import { apiFetch, type ApiError } from './api';

export const MUTATION_HEADER = 'x-mutation-id';

export type OfflineMutationSpec = {
  endpoint: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  resourceType: string;
  // why: clearly readable handle for the queued-mutations modal. "Mark Bruno started" >
  // "PATCH /appointments/clk7…/status".
  label: string;
  // why: optional optimistic-ack payload the caller hands back to TanStack Query's
  // setQueryData. Returned to the caller when we enqueue offline so the UI can paint
  // the new state immediately.
  optimisticResponse?: unknown;
};

export type OfflineMutationOutcome<T> =
  | { ok: true; data: T; offline: false }
  | { ok: true; data: T; offline: true; mutationId: string }
  | { ok: false; error: ApiError; offline: false };

function isOnline(): boolean {
  // why: navigator.onLine is the truthful "have we got a default route?" check. Even when
  // it's true the actual fetch can fail, but starting with it lets us shortcut to the
  // offline queue without a wasted network attempt.
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export async function mutate<T>(
  spec: OfflineMutationSpec,
): Promise<OfflineMutationOutcome<T>> {
  const id = uuidv7();
  const headers: Record<string, string> = { [MUTATION_HEADER]: id };
  if (spec.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (!isOnline()) {
    await enqueueQueued({ id, spec, headers });
    notifyOfflineQueueChanged();
    void requestBackgroundSync();
    return {
      ok: true,
      data: (spec.optimisticResponse ?? null) as T,
      offline: true,
      mutationId: id,
    };
  }

  const result = await apiFetch<T>(spec.endpoint, {
    method: spec.method,
    body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
    headers,
  });

  if (result.ok) {
    return { ok: true, data: result.data, offline: false };
  }

  // why: 5xx / network-style ApiError → queue for retry. apiFetch can't tell us "network
  // unreachable" vs "server 502" specifically, so we use the absence of an HTTP status to
  // mean "no response" and queue. 4xx → propagate to the caller as a normal failure.
  if (result.error.status >= 500) {
    await enqueueQueued({ id, spec, headers });
    notifyOfflineQueueChanged();
    void requestBackgroundSync();
    return {
      ok: true,
      data: (spec.optimisticResponse ?? null) as T,
      offline: true,
      mutationId: id,
    };
  }

  return { ok: false, error: result.error, offline: false };
}

async function enqueueQueued(args: {
  id: string;
  spec: OfflineMutationSpec;
  headers: Record<string, string>;
}): Promise<void> {
  const row: QueuedMutation = {
    id: args.id,
    endpoint: args.spec.endpoint,
    method: args.spec.method,
    body: args.spec.body ?? null,
    headers: args.headers,
    resourceType: args.spec.resourceType,
    resourceId: null,
    createdAt: Date.now(),
    attempts: 0,
    status: 'pending',
    lastError: null,
    conflictServerStatus: null,
    conflictServerBody: null,
    label: args.spec.label,
  };
  await enqueue(row);
}
