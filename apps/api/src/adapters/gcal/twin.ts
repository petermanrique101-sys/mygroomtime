import { createImpl } from './impl.js';
import type { GcalAdapter, GcalAdapterEnv } from './types.js';

export function createGcalTwinAdapter(env: GcalAdapterEnv): GcalAdapter {
  const base = env.twinUrl.replace(/\/$/, '');
  const impl = createImpl({
    oauthAuthorizeBase: `${base}/oauth/auth`,
    oauthTokenUrl: `${base}/oauth/token`,
    oauthRevokeUrl: `${base}/oauth/revoke`,
    calendarApiBase: base,
    clientId: env.oauthClientId || 'twin_client',
    clientSecret: env.oauthClientSecret || 'twin_secret',
  });
  return { mode: 'twin', ...impl };
}

export function buildTwinAuthorizeUrl(args: {
  twinUrl: string;
  redirectUri: string;
  state: string;
}): string {
  const base = args.twinUrl.replace(/\/$/, '');
  const url = new URL(`${base}/oauth/auth`);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('state', args.state);
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events');
  return url.toString();
}
