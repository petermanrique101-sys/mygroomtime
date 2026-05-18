import { createImpl } from './impl.js';
import type { GcalAdapter, GcalAdapterEnv } from './types.js';

export function createGcalLiveAdapter(env: GcalAdapterEnv): GcalAdapter {
  const impl = createImpl({
    oauthAuthorizeBase: 'https://accounts.google.com/o/oauth2/v2/auth',
    oauthTokenUrl: 'https://oauth2.googleapis.com/token',
    oauthRevokeUrl: 'https://oauth2.googleapis.com/revoke',
    calendarApiBase: 'https://www.googleapis.com',
    clientId: env.oauthClientId,
    clientSecret: env.oauthClientSecret,
  });
  return { mode: 'live', ...impl };
}

export function buildLiveAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', args.scope ?? 'https://www.googleapis.com/auth/calendar.events');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', args.state);
  return url.toString();
}
