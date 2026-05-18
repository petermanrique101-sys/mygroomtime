import type { FastifyInstance } from 'fastify';
import type { TwinState } from '../state.js';
import { asString, firstItem } from '../form-body.js';
import { lookupPrice } from '../prices.js';

type ProrationMath = {
  creditCents: number;
  chargeCents: number;
  amountDueCents: number;
  fraction: number;
  currentUnit: number;
  newUnit: number;
};

function computeProration(
  currentUnit: number,
  newUnit: number,
  periodStart: number,
  periodEnd: number,
  nowSec: number,
): ProrationMath {
  const periodLen = Math.max(1, periodEnd - periodStart);
  const remaining = Math.max(0, Math.min(periodLen, periodEnd - nowSec));
  const fraction = remaining / periodLen;
  const credit = Math.round(currentUnit * fraction);
  const charge = Math.round(newUnit * fraction);
  const net = charge - credit;
  return {
    creditCents: credit,
    chargeCents: charge,
    amountDueCents: Math.max(0, net),
    fraction,
    currentUnit,
    newUnit,
  };
}

function buildLines(
  math: ProrationMath,
  periodStart: number,
  periodEnd: number,
  currentName: string,
  newName: string,
): Array<Record<string, unknown>> {
  const nowSec = Math.floor(Date.now() / 1000);
  const lines: Array<Record<string, unknown>> = [
    {
      amount: -math.creditCents,
      currency: 'usd',
      description: `Unused time on ${currentName}`,
      proration: true,
      period: { start: nowSec, end: periodEnd },
    },
    {
      amount: math.chargeCents,
      currency: 'usd',
      description: `Remaining time on ${newName}`,
      proration: true,
      period: { start: nowSec, end: periodEnd },
    },
    {
      amount: math.newUnit,
      currency: 'usd',
      description: `${newName} (monthly)`,
      proration: false,
      period: { start: periodEnd, end: periodEnd + (periodEnd - periodStart) },
    },
  ];
  if (math.amountDueCents === 0 && math.creditCents > math.chargeCents) {
    lines.push({
      amount: 0,
      currency: 'usd',
      description: `Credit of $${((math.creditCents - math.chargeCents) / 100).toFixed(2)} will be applied to your next invoice`,
      proration: true,
      period: { start: nowSec, end: periodEnd },
    });
  }
  return lines;
}

export function registerInvoices(app: FastifyInstance, state: TwinState): void {
  const handler = async (
    req: { body?: unknown; query?: unknown },
    reply: { code: (n: number) => { send: (o: unknown) => unknown } },
  ): Promise<unknown> => {
    const source =
      req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0
        ? (req.body as Record<string, unknown>)
        : ((req.query ?? {}) as Record<string, unknown>);
    const subId = asString(source.subscription);
    if (!subId) {
      return reply
        .code(400)
        .send({ error: { type: 'invalid_request_error', message: 'subscription required' } });
    }
    const sub = state.subscriptions.get(subId);
    if (!sub) {
      return reply
        .code(404)
        .send({ error: { type: 'invalid_request_error', message: 'No such subscription' } });
    }
    const item = firstItem(source.subscription_items);
    const newPriceId = asString(item?.price) ?? sub.priceId;

    const currentPrice = lookupPrice(sub.priceId);
    const newPrice = lookupPrice(newPriceId);
    if (!currentPrice || !newPrice) {
      return reply.code(400).send({
        error: { type: 'invalid_request_error', message: 'unknown price id for proration' },
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const math = computeProration(
      currentPrice.unitAmount,
      newPrice.unitAmount,
      sub.currentPeriodStart,
      sub.currentPeriodEnd,
      nowSec,
    );

    const lines = buildLines(
      math,
      sub.currentPeriodStart,
      sub.currentPeriodEnd,
      currentPrice.productName,
      newPrice.productName,
    );

    return reply.code(200).send({
      object: 'invoice',
      currency: 'usd',
      customer: sub.customer,
      subscription: sub.id,
      amount_due: math.amountDueCents,
      period_start: sub.currentPeriodStart,
      period_end: sub.currentPeriodEnd,
      next_payment_attempt: sub.currentPeriodEnd,
      lines: { object: 'list', data: lines },
    });
  };

  // why: Stripe historically used GET /v1/invoices/upcoming; newer SDKs hit POST.
  // Accept both so live adapters can target whichever shape their SDK uses.
  app.post('/v1/invoices/upcoming', handler);
  app.get('/v1/invoices/upcoming', handler);
}
