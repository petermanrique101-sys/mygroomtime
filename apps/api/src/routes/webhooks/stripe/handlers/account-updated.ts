import { db } from '@mygroomtime/db';
import type { AccountUpdatedEvent } from '../../../../adapters/stripe/types.js';

export type HandlerResult = { ok: true } | { ok: false; reason: string };

export async function handleAccountUpdated(
  event: AccountUpdatedEvent,
): Promise<HandlerResult> {
  if (!event.accountId) return { ok: false, reason: 'missing account id' };
  const tenant = await db.global.tenant.findFirst({
    where: { stripeConnectAccountId: event.accountId },
    select: { id: true },
  });
  // why: an account.updated for an unknown account isn't a failure — Stripe replays
  // for other reasons (e.g., signup flows we never finished). Acknowledge cleanly.
  if (!tenant) return { ok: true };

  await db.global.tenant.update({
    where: { id: tenant.id },
    data: {
      stripeConnectChargesEnabled: event.chargesEnabled,
      stripeConnectPayoutsEnabled: event.payoutsEnabled,
      stripeConnectStatusUpdatedAt: new Date(),
    },
  });
  return { ok: true };
}
