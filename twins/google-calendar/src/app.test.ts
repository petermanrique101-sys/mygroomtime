import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApp, type TwinAppHandle } from './app.js';

let handle: TwinAppHandle;

beforeEach(async () => {
  handle = createApp({ logger: false });
  await handle.app.ready();
});

afterEach(async () => {
  await handle.app.close();
});

async function authorize(): Promise<{ access: string; refresh: string; email: string }> {
  const authRes = await handle.app.inject({
    method: 'GET',
    url: '/oauth/auth?redirect_uri=http://localhost:3000/cb&state=xyz',
  });
  expect(authRes.statusCode).toBe(302);
  const loc = authRes.headers.location as string;
  const code = new URL(loc).searchParams.get('code');
  expect(code).toBeTruthy();

  const tokRes = await handle.app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/json' },
    payload: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:3000/cb',
    },
  });
  expect(tokRes.statusCode).toBe(200);
  const tok = tokRes.json() as {
    access_token: string;
    refresh_token: string;
    id_token_claims: { email: string };
  };
  return { access: tok.access_token, refresh: tok.refresh_token, email: tok.id_token_claims.email };
}

describe('google-calendar twin — oauth', () => {
  it('auth → redirects with code', async () => {
    const res = await handle.app.inject({
      method: 'GET',
      url: '/oauth/auth?redirect_uri=http://x/cb&state=s1',
    });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.searchParams.get('code')).toMatch(/^TWIN_CODE_/);
    expect(loc.searchParams.get('state')).toBe('s1');
  });

  it('token exchange returns access + refresh', async () => {
    const { access, refresh } = await authorize();
    expect(access).toMatch(/^twin_at_/);
    expect(refresh).toMatch(/^twin_rt_/);
  });

  it('refresh_token grants a new access token', async () => {
    const { refresh } = await authorize();
    const res = await handle.app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/json' },
      payload: { grant_type: 'refresh_token', refresh_token: refresh },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { access_token: string };
    expect(body.access_token).toMatch(/^twin_at_/);
  });
});

describe('google-calendar twin — calendars + events', () => {
  it('GET calendarList returns the primary calendar', async () => {
    const { access, email } = await authorize();
    const res = await handle.app.inject({
      method: 'GET',
      url: '/calendar/v3/users/me/calendarList',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; summary: string; primary: boolean }> };
    expect(body.items.length).toBe(1);
    expect(body.items[0]!.id).toBe('primary');
    expect(body.items[0]!.summary).toBe(email);
    expect(body.items[0]!.primary).toBe(true);
  });

  it('insert + list returns the event with tags', async () => {
    const { access } = await authorize();
    const insRes = await handle.app.inject({
      method: 'POST',
      url: '/calendar/v3/calendars/primary/events',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      payload: {
        summary: 'Full Groom — Bruno',
        description: '1 A St',
        start: { dateTime: '2026-06-01T10:00:00.000Z' },
        end: { dateTime: '2026-06-01T11:30:00.000Z' },
        extendedProperties: { private: { mgtAppointmentId: 'appt_123', mgtTenantId: 't_1' } },
      },
    });
    expect(insRes.statusCode).toBe(200);
    const ev = insRes.json() as { id: string };
    expect(ev.id).toBeTruthy();

    const listRes = await handle.app.inject({
      method: 'GET',
      url: '/calendar/v3/calendars/primary/events',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json() as {
      items: Array<{
        id: string;
        summary: string;
        extendedProperties: { private: Record<string, string> };
      }>;
      nextSyncToken: string;
    };
    expect(list.items.find((i) => i.id === ev.id)?.summary).toBe('Full Groom — Bruno');
    expect(list.items[0]!.extendedProperties.private.mgtAppointmentId).toBe('appt_123');
    expect(list.nextSyncToken).toMatch(/^sync_/);
  });

  it('patch updates start/summary and bumps updated', async () => {
    const { access } = await authorize();
    const insRes = await handle.app.inject({
      method: 'POST',
      url: '/calendar/v3/calendars/primary/events',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      payload: {
        summary: 'Full Groom',
        start: { dateTime: '2026-06-01T10:00:00.000Z' },
        end: { dateTime: '2026-06-01T11:00:00.000Z' },
      },
    });
    const ev = insRes.json() as { id: string; updated: string };
    const prevUpdated = ev.updated;

    // why: wait at least 1ms so the new ISO timestamp differs from the create one.
    await new Promise((r) => setTimeout(r, 5));

    const patchRes = await handle.app.inject({
      method: 'PATCH',
      url: `/calendar/v3/calendars/primary/events/${ev.id}`,
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      payload: { summary: 'Updated', start: { dateTime: '2026-06-01T11:00:00.000Z' } },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json() as { summary: string; start: { dateTime: string }; updated: string };
    expect(patched.summary).toBe('Updated');
    expect(patched.start.dateTime).toBe('2026-06-01T11:00:00.000Z');
    expect(patched.updated > prevUpdated).toBe(true);
  });

  it('delete flips status to cancelled', async () => {
    const { access } = await authorize();
    const insRes = await handle.app.inject({
      method: 'POST',
      url: '/calendar/v3/calendars/primary/events',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      payload: { summary: 'X', start: { dateTime: '2026-06-01T10:00:00Z' }, end: { dateTime: '2026-06-01T11:00:00Z' } },
    });
    const ev = insRes.json() as { id: string };

    const delRes = await handle.app.inject({
      method: 'DELETE',
      url: `/calendar/v3/calendars/primary/events/${ev.id}`,
      headers: { authorization: `Bearer ${access}` },
    });
    expect(delRes.statusCode).toBe(204);

    const listRes = await handle.app.inject({
      method: 'GET',
      url: '/calendar/v3/calendars/primary/events',
      headers: { authorization: `Bearer ${access}` },
    });
    const list = listRes.json() as { items: Array<{ id: string; status: string }> };
    expect(list.items.find((i) => i.id === ev.id)?.status).toBe('cancelled');
  });

  it('syncToken returns only events updated after the token', async () => {
    const { access } = await authorize();
    await handle.app.inject({
      method: 'POST',
      url: '/calendar/v3/calendars/primary/events',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      payload: { summary: 'First', start: { dateTime: '2026-06-01T10:00:00Z' }, end: { dateTime: '2026-06-01T11:00:00Z' } },
    });
    const list1 = (await handle.app.inject({
      method: 'GET',
      url: '/calendar/v3/calendars/primary/events',
      headers: { authorization: `Bearer ${access}` },
    })).json() as { nextSyncToken: string };

    await new Promise((r) => setTimeout(r, 5));
    await handle.app.inject({
      method: 'POST',
      url: '/calendar/v3/calendars/primary/events',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      payload: { summary: 'Second', start: { dateTime: '2026-06-02T10:00:00Z' }, end: { dateTime: '2026-06-02T11:00:00Z' } },
    });
    const list2 = (await handle.app.inject({
      method: 'GET',
      url: `/calendar/v3/calendars/primary/events?syncToken=${list1.nextSyncToken}`,
      headers: { authorization: `Bearer ${access}` },
    })).json() as { items: Array<{ summary: string }> };
    expect(list2.items.length).toBe(1);
    expect(list2.items[0]!.summary).toBe('Second');
  });

  it('invalid syncToken returns 410', async () => {
    const { access } = await authorize();
    const res = await handle.app.inject({
      method: 'GET',
      url: '/calendar/v3/calendars/primary/events?syncToken=sync_does_not_exist',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.statusCode).toBe(410);
  });
});

describe('google-calendar twin — watch notifications', () => {
  it('watch channel fires on external event create', async () => {
    const { access } = await authorize();

    const received: Array<{ headers: Record<string, string>; bodyText: string }> = [];
    const server = await import('node:http').then(async (h) => {
      return new Promise<Server>((resolve, reject) => {
        const s = h.createServer((req, res) => {
          let buf = '';
          req.on('data', (c) => (buf += c.toString()));
          req.on('end', () => {
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) {
              if (typeof v === 'string') headers[k.toLowerCase()] = v;
            }
            received.push({ headers, bodyText: buf });
            res.statusCode = 200;
            res.end('ok');
          });
        });
        s.listen(0, '127.0.0.1', () => resolve(s));
        s.on('error', reject);
      });
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no addr');
    const webhook = `http://127.0.0.1:${addr.port}/hook`;

    const watchRes = await handle.app.inject({
      method: 'POST',
      url: '/calendar/v3/calendars/primary/events/watch',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      payload: { id: 'ch_test', type: 'web_hook', address: webhook, token: 'sec_test' },
    });
    expect(watchRes.statusCode).toBe(200);

    await handle.app.inject({
      method: 'POST',
      url: '/__twin__/external-event-created',
      headers: { 'content-type': 'application/json' },
      payload: {
        calendarId: 'primary',
        summary: 'Externally created',
        start: { dateTime: '2026-06-10T10:00:00Z' },
        end: { dateTime: '2026-06-10T11:00:00Z' },
      },
    });
    // why: fireWatchNotification kicks an async fetch; allow the loop to flush.
    await new Promise((r) => setTimeout(r, 80));

    server.close();

    expect(received.length).toBeGreaterThanOrEqual(1);
    const headers = received[0]!.headers;
    expect(headers['x-goog-channel-id']).toBe('ch_test');
    expect(headers['x-goog-channel-token']).toBe('sec_test');
    expect(headers['x-goog-resource-state']).toBe('exists');
  });
});
