import type { FastifyInstance } from 'fastify';
import type { TwinAccount, TwinState } from '../state.js';
import { asMetadata, asString } from '../form-body.js';
import { serializeAccount } from '../serialize.js';
import { deliverEvent, recordEvent, type WebhookConfig } from '../webhook.js';

const RETURN_PARAM = 'return';

export function registerAccounts(
  app: FastifyInstance,
  state: TwinState,
  cfg: WebhookConfig,
  getTwinOrigin: () => string,
): void {
  app.post('/v1/accounts', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const account: TwinAccount = {
      id: state.ids.next('acct'),
      email: asString(body.email) ?? null,
      country: asString(body.country) ?? 'US',
      capabilities: { card_payments: 'active', transfers: 'active' },
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
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
    const onboardingUrl = `${getTwinOrigin()}/__twin_onboarding/${accountId}?${RETURN_PARAM}=${encodeURIComponent(returnUrl)}`;
    return reply.code(200).send({
      object: 'account_link',
      url: onboardingUrl,
      expires_at: Math.floor(Date.now() / 1000) + 300,
      created: Math.floor(Date.now() / 1000),
    });
  });

  // why: the twin pretends to be Stripe's hosted onboarding flow. Visiting this URL
  // (which the platform redirected the owner to) flips the account into the fully
  // onboarded state, fires account.updated so the platform's webhook handler can
  // sync the tenant, and redirects back to the platform's return URL.
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/__twin_onboarding/:id',
    async (req, reply) => {
      const account = state.accounts.get(req.params.id);
      const returnUrl = req.query[RETURN_PARAM] ?? '';
      if (!account) {
        return reply.code(404).type('text/plain').send('Unknown account');
      }
      account.chargesEnabled = true;
      account.payoutsEnabled = true;
      account.detailsSubmitted = true;
      state.accounts.set(account.id, account);
      const event = recordEvent(state, 'account.updated', serializeAccount(account));
      await deliverEvent(cfg, event);
      if (returnUrl) return reply.redirect(returnUrl, 302);
      return reply.code(200).type('text/plain').send('Onboarding complete');
    },
  );
}
