import type { FastifyInstance } from 'fastify';
import type { TwinConfig } from '../app.js';
import type { TwinState, TwinTokenGrant } from '../state.js';

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

type AuthQuery = {
  redirect_uri?: string;
  state?: string;
  scope?: string;
  client_id?: string;
};

type TokenBody = {
  grant_type?: string;
  code?: string;
  refresh_token?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
};

export function registerOauth(
  app: FastifyInstance,
  state: TwinState,
  _cfg: TwinConfig,
): void {
  app.get<{ Querystring: AuthQuery }>('/oauth/auth', async (req, reply) => {
    const redirectUri = req.query.redirect_uri;
    const stateParam = req.query.state ?? '';
    if (!redirectUri) {
      return reply.code(400).send({ error: 'missing_redirect_uri' });
    }

    const code = state.ids.next('TWIN_CODE');
    const userIdx = state.tokens.size + 1;
    const grant: TwinTokenGrant = {
      code,
      accessToken: state.ids.next('twin_at'),
      refreshToken: state.ids.next('twin_rt'),
      userId: `twin-user-${userIdx}`,
      email: `twin-user-${userIdx}@mygroomtime.test`,
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
    };
    state.tokens.set(code, grant);
    state.tokensByAccess.set(grant.accessToken, grant);
    state.tokensByRefresh.set(grant.refreshToken, grant);

    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (stateParam) url.searchParams.set('state', stateParam);
    return reply.redirect(url.toString(), 302);
  });

  app.post('/oauth/token', async (req, reply) => {
    const body = readTokenBody(req.body);
    const grantType = body.grant_type;

    if (grantType === 'authorization_code') {
      const code = body.code;
      if (!code) return reply.code(400).send({ error: 'missing_code' });
      const grant = state.tokens.get(code);
      if (!grant) return reply.code(400).send({ error: 'invalid_code' });
      grant.accessToken = state.ids.next('twin_at');
      grant.expiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
      state.tokensByAccess.set(grant.accessToken, grant);
      return reply.send({
        access_token: grant.accessToken,
        refresh_token: grant.refreshToken,
        token_type: 'Bearer',
        expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        scope: 'https://www.googleapis.com/auth/calendar.events',
        id_token_claims: { sub: grant.userId, email: grant.email },
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = body.refresh_token;
      if (!refreshToken) return reply.code(400).send({ error: 'missing_refresh_token' });
      const grant = state.tokensByRefresh.get(refreshToken);
      if (!grant) return reply.code(400).send({ error: 'invalid_refresh_token' });
      grant.accessToken = state.ids.next('twin_at');
      grant.expiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
      state.tokensByAccess.set(grant.accessToken, grant);
      return reply.send({
        access_token: grant.accessToken,
        token_type: 'Bearer',
        expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        scope: 'https://www.googleapis.com/auth/calendar.events',
      });
    }

    return reply.code(400).send({ error: 'unsupported_grant_type' });
  });

  app.post('/oauth/revoke', async (req, reply) => {
    const body = readTokenBody(req.body);
    const tok = body.refresh_token ?? '';
    const grant = state.tokensByRefresh.get(tok);
    if (grant) {
      state.tokensByRefresh.delete(grant.refreshToken);
      state.tokensByAccess.delete(grant.accessToken);
    }
    return reply.code(200).send({});
  });
}

function readTokenBody(body: unknown): TokenBody {
  if (!body) return {};
  if (typeof body === 'string') {
    const out: TokenBody = {};
    for (const [k, v] of new URLSearchParams(body)) {
      (out as Record<string, string>)[k] = v;
    }
    return out;
  }
  if (typeof body === 'object') return body as TokenBody;
  return {};
}
