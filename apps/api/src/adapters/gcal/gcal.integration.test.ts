import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp as createTwin } from '@mygroomtime/twin-google-calendar';
import { createGcalTwinAdapter, buildTwinAuthorizeUrl } from './twin.js';

let twinUrl = '';
let twinHandle: ReturnType<typeof createTwin>;

beforeAll(async () => {
  twinHandle = createTwin({ logger: false });
  await twinHandle.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = twinHandle.app.server.address() as AddressInfo;
  twinUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await twinHandle.app.close();
});

beforeEach(() => {
  twinHandle.state.reset();
});

function adapter() {
  return createGcalTwinAdapter({
    mode: 'twin',
    oauthClientId: 'twin_client',
    oauthClientSecret: 'twin_secret',
    twinUrl,
  });
}

async function fullOauth(a: ReturnType<typeof adapter>): Promise<{ access: string; refresh: string }> {
  const authorize = buildTwinAuthorizeUrl({
    twinUrl,
    redirectUri: 'http://localhost:3000/cb',
    state: 's',
  });
  const res = await fetch(authorize, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const loc = res.headers.get('location');
  expect(loc).toBeTruthy();
  const code = new URL(loc!).searchParams.get('code');
  expect(code).toBeTruthy();
  const tokens = await a.exchangeOAuthCode({
    code: code!,
    redirectUri: 'http://localhost:3000/cb',
  });
  return { access: tokens.accessToken, refresh: tokens.refreshToken };
}

describe('gcal adapter ↔ twin (in-process)', () => {
  it('OAuth + listCalendars returns the primary calendar', async () => {
    const a = adapter();
    const { access } = await fullOauth(a);
    const cals = await a.listCalendars({ accessToken: access });
    expect(cals.length).toBe(1);
    expect(cals[0]!.id).toBe('primary');
    expect(cals[0]!.primary).toBe(true);
  });

  it('refreshAccessToken returns a new access_token', async () => {
    const a = adapter();
    const { refresh } = await fullOauth(a);
    const refreshed = await a.refreshAccessToken({ refreshToken: refresh });
    expect(refreshed.accessToken).toMatch(/^twin_at_/);
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
  });

  it('insertEvent stores the event with our extendedProperties tag', async () => {
    const a = adapter();
    const { access } = await fullOauth(a);
    const inserted = await a.insertEvent({
      accessToken: access,
      calendarId: 'primary',
      event: {
        summary: 'Full Groom — Bruno',
        description: 'shedding rake\n\n1 A St',
        start: '2026-06-01T15:00:00.000Z',
        end: '2026-06-01T16:30:00.000Z',
        extendedProperties: { private: { mgtAppointmentId: 'a1', mgtTenantId: 't1' } },
      },
    });
    expect(inserted.id).toBeTruthy();

    const list = await a.listEvents({ accessToken: access, calendarId: 'primary' });
    const found = list.events.find((e) => e.id === inserted.id);
    expect(found).toBeTruthy();
    expect(found!.extendedProperties.private.mgtAppointmentId).toBe('a1');
    expect(found!.extendedProperties.private.mgtTenantId).toBe('t1');
    expect(list.nextSyncToken).toBeTruthy();
  });

  it('updateEvent + listEvents(syncToken) returns only the changed event', async () => {
    const a = adapter();
    const { access } = await fullOauth(a);
    const ev = await a.insertEvent({
      accessToken: access,
      calendarId: 'primary',
      event: {
        summary: 'A',
        start: '2026-06-01T15:00:00.000Z',
        end: '2026-06-01T16:00:00.000Z',
      },
    });
    const first = await a.listEvents({ accessToken: access, calendarId: 'primary' });
    expect(first.nextSyncToken).toBeTruthy();

    await new Promise((r) => setTimeout(r, 5));
    await a.updateEvent({
      accessToken: access,
      calendarId: 'primary',
      eventId: ev.id,
      patch: { summary: 'B', start: '2026-06-01T16:00:00.000Z' },
    });

    const second = await a.listEvents({
      accessToken: access,
      calendarId: 'primary',
      syncToken: first.nextSyncToken!,
    });
    expect(second.events.length).toBe(1);
    expect(second.events[0]!.summary).toBe('B');
  });

  it('deleteEvent flips status to cancelled in syncToken delta', async () => {
    const a = adapter();
    const { access } = await fullOauth(a);
    const ev = await a.insertEvent({
      accessToken: access,
      calendarId: 'primary',
      event: {
        summary: 'X',
        start: '2026-06-01T15:00:00.000Z',
        end: '2026-06-01T16:00:00.000Z',
      },
    });
    const first = await a.listEvents({ accessToken: access, calendarId: 'primary' });
    await new Promise((r) => setTimeout(r, 5));
    await a.deleteEvent({ accessToken: access, calendarId: 'primary', eventId: ev.id });

    const second = await a.listEvents({
      accessToken: access,
      calendarId: 'primary',
      syncToken: first.nextSyncToken!,
    });
    expect(second.events.length).toBe(1);
    expect(second.events[0]!.status).toBe('cancelled');
  });

  it('watchChannel fires a notification when an external event lands', async () => {
    const a = adapter();
    const { access } = await fullOauth(a);

    const received: Array<Record<string, string>> = [];
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      const hdrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') hdrs[k.toLowerCase()] = v;
      }
      received.push(hdrs);
      res.statusCode = 200;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    const webhook = `http://127.0.0.1:${addr.port}/hook`;

    const channelId = `ch-${Date.now()}`;
    const channelToken = 'sec_xyz';
    const channel = await a.watchChannel({
      accessToken: access,
      calendarId: 'primary',
      webhookUrl: webhook,
      channelId,
      channelToken,
    });
    expect(channel.channelId).toBe(channelId);

    // Simulate external creation via the twin's admin route.
    await fetch(`${twinUrl}/__twin__/external-event-created`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        calendarId: 'primary',
        summary: 'External',
        start: { dateTime: '2026-06-02T10:00:00.000Z' },
        end: { dateTime: '2026-06-02T11:00:00.000Z' },
        extendedProperties: { private: { mgtAppointmentId: 'appt_X' } },
      }),
    });

    await new Promise((r) => setTimeout(r, 80));
    server.close();

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]!['x-goog-channel-id']).toBe(channelId);
    expect(received[0]!['x-goog-channel-token']).toBe(channelToken);
  });
});
