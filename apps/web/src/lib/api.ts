const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';

export type ApiError = {
  status: number;
  error: string;
  message: string;
};

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  const headers = new Headers(init.headers ?? {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (res.status === 204) return { ok: true, data: undefined as unknown as T };
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;
  if (res.ok) return { ok: true, data: body as T };
  return {
    ok: false,
    error: {
      status: res.status,
      error: (body as { error?: string } | null)?.error ?? 'request_failed',
      message:
        (body as { message?: string } | null)?.message ?? `Request failed (${res.status}).`,
    },
  };
}
