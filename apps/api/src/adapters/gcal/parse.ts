import type { GcalEvent, GcalEventInput, GcalEventPatch } from './types.js';

type RawEvent = {
  id?: string;
  summary?: string;
  description?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
  updated?: string;
};

export function parseEvent(raw: unknown): GcalEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawEvent;
  const id = r.id;
  const start = r.start?.dateTime ?? r.start?.date;
  const end = r.end?.dateTime ?? r.end?.date;
  if (!id || !start || !end) return null;
  return {
    id,
    summary: r.summary,
    description: r.description,
    start,
    end,
    status: r.status === 'cancelled' ? 'cancelled' : 'confirmed',
    extendedProperties: { private: r.extendedProperties?.private ?? {} },
    updated: r.updated ?? new Date(0).toISOString(),
  };
}

export function parseEventList(raw: unknown): GcalEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const items = (raw as { items?: unknown[] }).items ?? [];
  const out: GcalEvent[] = [];
  for (const item of items) {
    const parsed = parseEvent(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function serializeEventInput(input: GcalEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? '',
    start: { dateTime: input.start },
    end: { dateTime: input.end },
  };
  if (input.status) body.status = input.status;
  if (input.extendedProperties?.private) {
    body.extendedProperties = { private: input.extendedProperties.private };
  }
  return body;
}

export function serializeEventPatch(patch: GcalEventPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.start) body.start = { dateTime: patch.start };
  if (patch.end) body.end = { dateTime: patch.end };
  if (patch.status) body.status = patch.status;
  if (patch.extendedProperties?.private) {
    body.extendedProperties = { private: patch.extendedProperties.private };
  }
  return body;
}

// why: classified at one place so the worker / OAuth route can detect "user revoked"
// vs "transient 5xx" without grepping error messages. Google returns 401 once the
// refresh token has been revoked; 403/404 on a watch channel call means the channel
// was already torn down; 410 on listEvents means "syncToken is invalid → full resync".
export type GcalErrorKind =
  | 'auth_invalid'
  | 'sync_token_invalid'
  | 'not_found'
  | 'rate_limited'
  | 'transient'
  | 'bad_request';

export class GcalHttpError extends Error {
  readonly status: number;
  readonly kind: GcalErrorKind;
  readonly bodyText: string;
  constructor(status: number, bodyText: string, kind: GcalErrorKind) {
    super(`gcal http ${status}`);
    this.name = 'GcalHttpError';
    this.status = status;
    this.bodyText = bodyText;
    this.kind = kind;
  }
}

export function classifyStatus(status: number): GcalErrorKind {
  if (status === 401) return 'auth_invalid';
  if (status === 403) return 'auth_invalid';
  if (status === 410) return 'sync_token_invalid';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'transient';
  return 'bad_request';
}
