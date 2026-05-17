import type { FastifyInstance } from 'fastify';
import type { TwinAccount, TwinState } from '../state.js';
import { asMetadata, asString } from '../form-body.js';
import { serializeAccount } from '../serialize.js';

export function registerAccounts(app: FastifyInstance, state: TwinState): void {
  app.post('/v1/accounts', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const account: TwinAccount = {
      id: state.ids.next('acct'),
      email: asString(body.email) ?? null,
      country: asString(body.country) ?? 'US',
      capabilities: { card_payments: 'active', transfers: 'active' },
      metadata: asMetadata(body.metadata),
    };
    state.accounts.set(account.id, account);
    return reply.code(200).send(serializeAccount(account));
  });

  app.get<{ Params: { id: string } }>('/v1/accounts/:id', async (req, reply) => {
    const account = state.accounts.get(req.params.id);
    if (!account) {
      return reply
        .code(404)
        .send({ error: { type: 'invalid_request_error', message: 'No such account' } });
    }
    return reply.code(200).send(serializeAccount(account));
  });

  app.post('/v1/account_links', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const accountId = asString(body.account);
    if (!accountId || !state.accounts.has(accountId)) {
      return reply
        .code(400)
        .send({ error: { type: 'invalid_request_error', message: 'account required' } });
    }
    const returnUrl = asString(body.return_url) ?? '';
    const url = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}twin_account=${accountId}`;
    return reply.code(200).send({
      object: 'account_link',
      url,
      expires_at: Math.floor(Date.now() / 1000) + 300,
      created: Math.floor(Date.now() / 1000),
    });
  });
}
