import { encodeFormBody, gcalFetch } from './http.js';
import {
  parseEvent,
  parseEventList,
  serializeEventInput,
  serializeEventPatch,
} from './parse.js';
import type {
  DeleteEventInput,
  ExchangeOAuthCodeInput,
  GcalCalendar,
  GcalRefreshedToken,
  GcalTokens,
  InsertEventInput,
  InsertEventOutput,
  ListCalendarsInput,
  ListEventsInput,
  ListEventsOutput,
  RefreshAccessTokenInput,
  RevokeTokenInput,
  StopChannelInput,
  UpdateEventInput,
  UpdateEventOutput,
  WatchChannelInput,
  WatchChannelOutput,
} from './types.js';

export type GcalEndpoints = {
  oauthAuthorizeBase: string;
  oauthTokenUrl: string;
  oauthRevokeUrl: string;
  calendarApiBase: string;
  clientId: string;
  clientSecret: string;
};

export type GcalImpl = {
  exchangeOAuthCode(input: ExchangeOAuthCodeInput): Promise<GcalTokens>;
  refreshAccessToken(input: RefreshAccessTokenInput): Promise<GcalRefreshedToken>;
  revokeRefreshToken(input: RevokeTokenInput): Promise<void>;
  listCalendars(input: ListCalendarsInput): Promise<GcalCalendar[]>;
  insertEvent(input: InsertEventInput): Promise<InsertEventOutput>;
  updateEvent(input: UpdateEventInput): Promise<UpdateEventOutput>;
  deleteEvent(input: DeleteEventInput): Promise<void>;
  listEvents(input: ListEventsInput): Promise<ListEventsOutput>;
  watchChannel(input: WatchChannelInput): Promise<WatchChannelOutput>;
  stopChannel(input: StopChannelInput): Promise<void>;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token_claims?: { sub?: string; email?: string };
  id_token?: string;
};

export function createImpl(ep: GcalEndpoints): GcalImpl {
  return {
    async exchangeOAuthCode(input) {
      const body = encodeFormBody({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: ep.clientId,
        client_secret: ep.clientSecret,
      });
      const res = (await gcalFetch(ep.oauthTokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })) as TokenResponse;
      const access = res.access_token ?? '';
      const refresh = res.refresh_token ?? '';
      const expiresIn = res.expires_in ?? 3600;
      const claims = decodeIdTokenClaims(res.id_token, res.id_token_claims);
      return {
        accessToken: access,
        refreshToken: refresh,
        expiresAt: Date.now() + expiresIn * 1000,
        googleUserId: claims.sub ?? 'unknown',
        googleEmail: claims.email ?? null,
      };
    },

    async refreshAccessToken(input) {
      const body = encodeFormBody({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: ep.clientId,
        client_secret: ep.clientSecret,
      });
      const res = (await gcalFetch(ep.oauthTokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })) as TokenResponse;
      return {
        accessToken: res.access_token ?? '',
        expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
      };
    },

    async revokeRefreshToken(input) {
      try {
        await gcalFetch(ep.oauthRevokeUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: encodeFormBody({ token: input.refreshToken, refresh_token: input.refreshToken }),
        });
      } catch {
        // why: revoke is best-effort. A 400 here usually means "already revoked"; we still
        // proceed to delete the row + watch channel locally.
      }
    },

    async listCalendars(input) {
      const res = (await gcalFetch(
        `${ep.calendarApiBase}/calendar/v3/users/me/calendarList`,
        { headers: bearer(input.accessToken) },
      )) as { items?: Array<Record<string, unknown>> };
      const items = res.items ?? [];
      return items.map((it) => ({
        id: String(it.id ?? ''),
        summary: String(it.summary ?? ''),
        primary: it.primary === true,
        accessRole: typeof it.accessRole === 'string' ? it.accessRole : undefined,
      }));
    },

    async insertEvent(input) {
      const res = await gcalFetch(
        `${ep.calendarApiBase}/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
        {
          method: 'POST',
          headers: bearer(input.accessToken),
          body: serializeEventInput(input.event),
        },
      );
      const ev = parseEvent(res);
      if (!ev) throw new Error('gcal insertEvent returned malformed event');
      return { id: ev.id, updated: ev.updated };
    },

    async updateEvent(input) {
      const res = await gcalFetch(
        `${ep.calendarApiBase}/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
        {
          method: 'PATCH',
          headers: bearer(input.accessToken),
          body: serializeEventPatch(input.patch),
        },
      );
      const ev = parseEvent(res);
      if (!ev) throw new Error('gcal updateEvent returned malformed event');
      return { id: ev.id, updated: ev.updated };
    },

    async deleteEvent(input) {
      await gcalFetch(
        `${ep.calendarApiBase}/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
        { method: 'DELETE', headers: bearer(input.accessToken) },
      );
    },

    async listEvents(input) {
      const url = new URL(
        `${ep.calendarApiBase}/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
      );
      if (input.syncToken) url.searchParams.set('syncToken', input.syncToken);
      try {
        const res = (await gcalFetch(url.toString(), {
          headers: bearer(input.accessToken),
        })) as { nextSyncToken?: string };
        return {
          events: parseEventList(res),
          nextSyncToken: res.nextSyncToken ?? null,
        };
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          'kind' in err &&
          (err as { kind?: string }).kind === 'sync_token_invalid'
        ) {
          return { events: [], nextSyncToken: null, fullResyncRequired: true };
        }
        throw err;
      }
    },

    async watchChannel(input) {
      const res = (await gcalFetch(
        `${ep.calendarApiBase}/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/watch`,
        {
          method: 'POST',
          headers: bearer(input.accessToken),
          body: {
            id: input.channelId,
            type: 'web_hook',
            address: input.webhookUrl,
            token: input.channelToken,
            params: input.ttlSeconds ? { ttl: String(input.ttlSeconds) } : undefined,
          },
        },
      )) as { id?: string; resourceId?: string; expiration?: string };
      const expirationMs = res.expiration ? Number(res.expiration) : Date.now() + 7 * 24 * 60 * 60 * 1000;
      return {
        channelId: res.id ?? input.channelId,
        resourceId: res.resourceId ?? '',
        expirationMs,
      };
    },

    async stopChannel(input) {
      try {
        await gcalFetch(`${ep.calendarApiBase}/calendar/v3/channels/stop`, {
          method: 'POST',
          headers: bearer(input.accessToken),
          body: { id: input.channelId, resourceId: input.resourceId },
        });
      } catch {
        // why: stop-channel is best-effort. If the channel already expired or is unknown
        // to Google, we still want the local row to delete.
      }
    },
  };
}

function bearer(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

function decodeIdTokenClaims(
  idToken: string | undefined,
  fallback: { sub?: string; email?: string } | undefined,
): { sub?: string; email?: string } {
  if (idToken) {
    // why: real Google id_token is a JWT — base64url-decode the payload (2nd segment).
    // We don't verify the signature here; the access_token round-trip is the trust anchor.
    const parts = idToken.split('.');
    if (parts.length >= 2) {
      try {
        const json = Buffer.from(parts[1] as string, 'base64url').toString('utf8');
        const parsed = JSON.parse(json) as { sub?: string; email?: string };
        return { sub: parsed.sub, email: parsed.email };
      } catch {
        // fall through
      }
    }
  }
  return fallback ?? {};
}
