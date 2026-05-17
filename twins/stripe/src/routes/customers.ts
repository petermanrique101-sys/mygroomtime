import type { FastifyInstance } from 'fastify';
import type { TwinState, TwinCustomer } from '../state.js';
import { asMetadata, asString } from '../form-body.js';
import { serializeCustomer } from '../serialize.js';

export function registerCustomers(app: FastifyInstance, state: TwinState): void {
  app.post('/v1/customers', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = asString(body.email) ?? '';
    if (email.length === 0) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'email required' } });
    }
    const customer: TwinCustomer = {
      id: state.ids.next('cus'),
      email,
      name: asString(body.name) ?? null,
      created: Math.floor(Date.now() / 1000),
      metadata: asMetadata(body.metadata),
    };
    state.customers.set(customer.id, customer);
    return reply.code(200).send(serializeCustomer(customer));
  });

  app.get<{ Params: { id: string } }>('/v1/customers/:id', async (req, reply) => {
    const customer = state.customers.get(req.params.id);
    if (!customer) {
      return reply
        .code(404)
        .send({ error: { type: 'invalid_request_error', message: 'No such customer' } });
    }
    return reply.code(200).send(serializeCustomer(customer));
  });
}
