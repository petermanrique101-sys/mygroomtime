import type { FastifyInstance } from 'fastify';
import type { TwinState } from '../state.js';
import { asString } from '../form-body.js';

const RETURN_PARAM = 'return';

export function registerBillingPortal(
  app: FastifyInstance,
  state: TwinState,
  getTwinOrigin: () => string,
): void {
  app.post('/v1/billing_portal/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const customerId = asString(body.customer);
    if (!customerId || !state.customers.has(customerId)) {
      return reply
        .code(400)
        .send({ error: { type: 'invalid_request_error', message: 'customer required' } });
    }
    const returnUrl = asString(body.return_url) ?? '';
    const sessionId = state.ids.next('bps');
    const url = `${getTwinOrigin()}/__twin_billing_portal/${sessionId}?${RETURN_PARAM}=${encodeURIComponent(returnUrl)}`;
    return reply.code(200).send({
      id: sessionId,
      object: 'billing_portal.session',
      customer: customerId,
      return_url: returnUrl,
      url,
      created: Math.floor(Date.now() / 1000),
    });
  });

  // why: real Stripe hosts the portal; the twin renders a stub page with a single
  // "Back to app" link so end-to-end tests can prove the redirect round-trip works
  // without modelling card/cancel UI here.
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/__twin_billing_portal/:id',
    async (req, reply) => {
      const returnUrl = req.query[RETURN_PARAM] ?? '';
      if (req.query.auto === '1' && returnUrl) {
        return reply.redirect(returnUrl, 302);
      }
      const safeReturn = returnUrl.replace(/"/g, '&quot;');
      const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Twin Billing Portal · ${req.params.id}</title>
<style>
body{margin:0;font:16px system-ui,sans-serif;background:#f9fafb;color:#111827;}
main{max-width:420px;margin:48px auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);}
h1{font-size:18px;margin:0 0 8px;}
p{color:#6b7280;font-size:14px;margin:0 0 16px;}
a{display:block;width:100%;box-sizing:border-box;text-align:center;padding:12px 16px;background:#111827;color:#fff;border-radius:8px;font-weight:600;text-decoration:none;}
.note{margin-top:16px;font-size:12px;color:#9ca3af;}
</style>
</head>
<body>
<main>
<h1>Twin Billing Portal</h1>
<p>Stripe's customer portal lives here in production. In the twin, use this page to confirm the round-trip back to your app.</p>
<a href="${safeReturn}">Back to app</a>
<p class="note">Session: ${req.params.id}</p>
</main>
</body>
</html>`;
      return reply.code(200).type('text/html').send(html);
    },
  );
}
