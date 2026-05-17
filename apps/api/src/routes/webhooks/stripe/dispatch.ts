import type { ParsedStripeEvent } from '../../../adapters/stripe/types.js';
import { handleCheckoutCompleted } from './handlers/checkout-completed.js';
import { handleSubscriptionUpdated } from './handlers/subscription-updated.js';
import { handleSubscriptionDeleted } from './handlers/subscription-deleted.js';
import { handleInvoicePaymentFailed } from './handlers/invoice-payment-failed.js';

export type DispatchResult =
  | { kind: 'ok' }
  | { kind: 'unhandled'; rawType: string }
  | { kind: 'handler_error'; reason: string }
  | { kind: 'handler_exception'; error: Error };

export async function dispatchEvent(event: ParsedStripeEvent): Promise<DispatchResult> {
  try {
    if (event.type === 'checkout.session.completed') {
      const res = await handleCheckoutCompleted(event);
      return res.ok ? { kind: 'ok' } : { kind: 'handler_error', reason: res.reason };
    }
    if (event.type === 'customer.subscription.updated') {
      const res = await handleSubscriptionUpdated(event);
      return res.ok ? { kind: 'ok' } : { kind: 'handler_error', reason: res.reason };
    }
    if (event.type === 'customer.subscription.deleted') {
      const res = await handleSubscriptionDeleted(event);
      return res.ok ? { kind: 'ok' } : { kind: 'handler_error', reason: res.reason };
    }
    if (event.type === 'invoice.payment_failed') {
      const res = await handleInvoicePaymentFailed(event);
      return res.ok ? { kind: 'ok' } : { kind: 'handler_error', reason: res.reason };
    }
    return { kind: 'unhandled', rawType: event.rawType };
  } catch (err) {
    return { kind: 'handler_exception', error: err as Error };
  }
}
