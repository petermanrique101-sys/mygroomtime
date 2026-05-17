import { db } from '@mygroomtime/db';
import type { InvoicePaymentFailedEvent } from '../../../../adapters/stripe/types.js';
import type { HandlerResult } from './checkout-completed.js';

export async function handleInvoicePaymentFailed(
  event: InvoicePaymentFailedEvent,
): Promise<HandlerResult> {
  if (!event.subscriptionId) return { ok: true };
  const tenant = await db.global.tenant.findFirst({
    where: { stripeSubscriptionId: event.subscriptionId },
    select: { id: true },
  });
  if (!tenant) return { ok: false, reason: 'no tenant matches subscription' };

  // why: don't flip plan yet. Stripe sends customer.subscription.updated with
  // status=past_due next; that's where the read-only mode kicks in.
  await db.global.tenant.update({
    where: { id: tenant.id },
    data: { pastDueAt: new Date() },
  });
  return { ok: true };
}
