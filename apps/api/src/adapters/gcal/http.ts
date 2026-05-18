import { classifyStatus, GcalHttpError } from './parse.js';

export type GcalFetchInit = Omit<RequestInit, 'body'> & { body?: string | object };

export async function gcalFetch(url: string, init: GcalFetchInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  let body: string | undefined;
  if (init.body !== undefined) {
    if (typeof init.body === 'string') {
      body = init.body;
    } else {
      body = JSON.stringify(init.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  }
  const res = await fetch(url, { ...init, headers, body });
  const text = await res.text().catch(() => '');
  if (res.status === 204 || text.length === 0) {
    if (!res.ok) {
      throw new GcalHttpError(res.status, text, classifyStatus(res.status));
    }
    return null;
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new GcalHttpError(res.status, text, classifyStatus(res.status));
    }
    return text;
  }
  if (!res.ok) {
    throw new GcalHttpError(res.status, text, classifyStatus(res.status));
  }
  return parsed;
}

export function encodeFormBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}
