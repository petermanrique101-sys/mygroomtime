import type { MutationContext } from '../middleware/mutation-dedupe.js';

// why: when a mutation arrives via offline-replay it carries a client-generated UUIDv7
// (the X-Mutation-Id header → request.mutation.id). Routing the same UUIDv7 into Stripe
// as the idempotency key means a replay produces ONE PaymentIntent on the wire even if the
// app-level MutationLog short-circuit somehow misses (e.g. a process crash between the
// Stripe call and the log write).
//
// For in-online calls the mutation context is absent — fall back to the resource-specific
// key the chunk-16.5 complete flow has been using.

export function stripeIdempotencyKey(
  mutation: MutationContext | undefined,
  fallback: string,
): string {
  if (mutation && mutation.id) return `mut-${mutation.id}`;
  return fallback;
}
