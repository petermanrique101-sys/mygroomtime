import type { TwinEvent, TwinState, TwinWatchChannel } from './state.js';

export type EventInputBody = {
  summary?: string;
  description?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  status?: string;
  extendedProperties?: { private?: Record<string, string> };
};

export function serializeEvent(e: TwinEvent): Record<string, unknown> {
  return {
    kind: 'calendar#event',
    id: e.id,
    summary: e.summary,
    description: e.description,
    status: e.status,
    start: { dateTime: e.startIso },
    end: { dateTime: e.endIso },
    extendedProperties: e.extendedProperties,
    updated: e.updated,
    created: e.createdAt,
  };
}

export function buildEvent(args: {
  state: TwinState;
  calendarId: string;
  body: EventInputBody;
}): TwinEvent {
  const id = args.state.ids.next('twinevt');
  const now = new Date().toISOString();
  const ev: TwinEvent = {
    id,
    calendarId: args.calendarId,
    summary: args.body.summary ?? '',
    description: args.body.description ?? '',
    startIso: args.body.start?.dateTime ?? new Date().toISOString(),
    endIso:
      args.body.end?.dateTime ??
      new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    status: args.body.status === 'cancelled' ? 'cancelled' : 'confirmed',
    extendedProperties: { private: args.body.extendedProperties?.private ?? {} },
    updated: now,
    createdAt: now,
  };
  args.state.events.set(id, ev);
  return ev;
}

export function applyEventPatch(
  ev: TwinEvent,
  body: EventInputBody,
): TwinEvent {
  if (body.summary !== undefined) ev.summary = body.summary;
  if (body.description !== undefined) ev.description = body.description;
  if (body.start?.dateTime) ev.startIso = body.start.dateTime;
  if (body.end?.dateTime) ev.endIso = body.end.dateTime;
  if (body.status === 'cancelled' || body.status === 'confirmed') ev.status = body.status;
  if (body.extendedProperties?.private) {
    ev.extendedProperties = {
      private: { ...ev.extendedProperties.private, ...body.extendedProperties.private },
    };
  }
  ev.updated = new Date().toISOString();
  return ev;
}

export function listEventsForCalendar(
  state: TwinState,
  calendarId: string,
  syncTokenAfterMs: number | null,
): TwinEvent[] {
  const out: TwinEvent[] = [];
  for (const ev of state.events.values()) {
    if (ev.calendarId !== calendarId) continue;
    if (syncTokenAfterMs !== null && new Date(ev.updated).getTime() <= syncTokenAfterMs) {
      continue;
    }
    out.push(ev);
  }
  return out.sort((a, b) => a.updated.localeCompare(b.updated));
}

export function fireWatchNotification(args: {
  state: TwinState;
  calendarId: string;
}): void {
  for (const ch of args.state.watchChannels.values()) {
    if (ch.calendarId !== args.calendarId) continue;
    if (ch.expirationMs < Date.now()) continue;
    void deliver(args.state, ch);
  }
}

async function deliver(state: TwinState, ch: TwinWatchChannel): Promise<void> {
  const headers: Record<string, string> = {
    'X-Goog-Channel-Id': ch.channelId,
    'X-Goog-Resource-Id': ch.resourceId,
    'X-Goog-Resource-State': 'exists',
    'X-Goog-Message-Number': String(state.deliveries.length + 1),
    'content-type': 'application/json',
  };
  if (ch.token) headers['X-Goog-Channel-Token'] = ch.token;

  let status = 0;
  let error: string | null = null;
  try {
    const res = await fetch(ch.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    status = res.status;
    if (res.status < 200 || res.status >= 300) {
      error = await res.text().catch(() => 'delivery_failed');
    }
  } catch (err) {
    error = (err as Error).message;
  }
  state.deliveries.push({
    at: new Date().toISOString(),
    channelId: ch.channelId,
    status,
    error,
  });
}
