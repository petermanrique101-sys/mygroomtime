import { apiFetch } from './api';

export type GcalStatus = {
  connected: boolean;
  googleEmail: string | null;
  watchExpiresAt: string | null;
  needsReauth: boolean;
  tierGated: boolean;
};

export async function fetchGcalStatus(): ReturnType<typeof apiFetch<GcalStatus>> {
  return apiFetch<GcalStatus>('/settings/integrations/google-calendar');
}

export async function startGcalConnect(): ReturnType<typeof apiFetch<{ url: string }>> {
  return apiFetch<{ url: string }>('/settings/integrations/google-calendar/connect', {
    method: 'POST',
  });
}

export async function disconnectGcal(): ReturnType<typeof apiFetch<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>('/settings/integrations/google-calendar/disconnect', {
    method: 'POST',
  });
}

export type GcalOpsStatus = {
  connected: boolean;
  googleEmail: string | null;
  needsReauth: boolean;
};

export async function fetchGcalOpsStatus(): ReturnType<typeof apiFetch<GcalOpsStatus>> {
  return apiFetch<GcalOpsStatus>('/settings/integrations/google-calendar/operations');
}

export async function startGcalOpsConnect(): ReturnType<typeof apiFetch<{ url: string }>> {
  return apiFetch<{ url: string }>(
    '/settings/integrations/google-calendar/operations/connect',
    { method: 'POST' },
  );
}

export async function disconnectGcalOps(): ReturnType<typeof apiFetch<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>(
    '/settings/integrations/google-calendar/operations/disconnect',
    { method: 'POST' },
  );
}
