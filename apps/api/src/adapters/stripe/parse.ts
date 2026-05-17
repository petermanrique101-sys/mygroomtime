import type { ParsedStripeEvent } from './types.js';

type RawEvent = {
  id?: unknown;
  type?: unknown;
  data?: { object?: Record<string, unknown> };
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function metadataOf(obj: Record<string, unknown>): Record<string, string> {
  const m = obj.metadata;
  if (!m || typeof m !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function parseStripeEvent(raw: unknown): ParsedStripeEvent {
  const evt = (raw ?? {}) as RawEvent;
  const id = str(evt.id) ?? 'evt_unknown';
  const type = str(evt.type) ?? 'unknown';
  const obj = (evt.data?.object ?? {}) as Record<string, unknown>;

  if (type === 'checkout.session.completed') {
    const sub = obj.subscription;
    const currentPeriodEnd =
      num(obj.current_period_end) ?? extractSubscriptionPeriodEnd(obj);
    return {
      type: 'checkout.session.completed',
      id,
      sessionId: str(obj.id) ?? '',
      customerId: str(obj.customer),
      subscriptionId: typeof sub === 'string' ? sub : str((sub as Record<string, unknown> | null)?.id ?? null),
      metadata: metadataOf(obj),
      currentPeriodEnd,
    };
  }

  if (type === 'customer.subscription.updated') {
    return {
      type: 'customer.subscription.updated',
      id,
      subscriptionId: str(obj.id) ?? '',
      customerId: str(obj.customer),
      status: str(obj.status) ?? 'unknown',
      currentPeriodEnd: num(obj.current_period_end),
    };
  }

  if (type === 'customer.subscription.deleted') {
    return {
      type: 'customer.subscription.deleted',
      id,
      subscriptionId: str(obj.id) ?? '',
      customerId: str(obj.customer),
      status: str(obj.status) ?? 'canceled',
    };
  }

  if (type === 'invoice.payment_failed') {
    return {
      type: 'invoice.payment_failed',
      id,
      subscriptionId: str(obj.subscription),
      customerId: str(obj.customer),
      attemptCount: num(obj.attempt_count) ?? 0,
    };
  }

  return { type: 'unhandled', id, rawType: type };
}

function extractSubscriptionPeriodEnd(obj: Record<string, unknown>): number | null {
  const sub = obj.subscription;
  if (sub && typeof sub === 'object') {
    const r = sub as Record<string, unknown>;
    return num(r.current_period_end);
  }
  return null;
}
