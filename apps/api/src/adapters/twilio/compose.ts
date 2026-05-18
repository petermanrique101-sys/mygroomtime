import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, PlanTier, SmsDirection, SmsStatus, type TenantScopedDb } from '@mygroomtime/db';
import type { SendSmsInput, SendSmsResult, VerifyTwilioWebhookInput } from './types.js';

const STOP_SUFFIX = ' Reply STOP to opt out.';
const MAX_TOTAL = 160;
const PRO_PLUS: ReadonlyArray<PlanTier> = [PlanTier.pro, PlanTier.business];

export type DoSendResult =
  | { ok: true; twilioSid: string }
  | { ok: false; errorMessage: string };

export type SendDeps = {
  fromNumber: string;
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
  doSend(payload: { to: string; from: string; body: string }): Promise<DoSendResult>;
};

// why: every SMS message we send must end with the STOP suffix (CTIA + Twilio compliance).
// Append it here so callers can't forget; truncate the leading body if the total exceeds
// 160 chars so the suffix is never cut off. We use '…' as the truncation marker because
// it's a single char and clearly indicates "more was here".
export function withStopSuffix(body: string): { final: string; truncated: boolean } {
  const totalIfNoTrunc = body.length + STOP_SUFFIX.length;
  if (totalIfNoTrunc <= MAX_TOTAL) {
    return { final: body + STOP_SUFFIX, truncated: false };
  }
  const maxBody = MAX_TOTAL - STOP_SUFFIX.length - 1; // -1 for the ellipsis char
  if (maxBody <= 0) {
    // shouldn't happen — the suffix is 22 chars — but guard so we never emit just '…'
    return { final: STOP_SUFFIX.trim(), truncated: true };
  }
  return { final: body.slice(0, maxBody) + '…' + STOP_SUFFIX, truncated: true };
}

export type PreflightShortCircuit = {
  kind: 'short_circuit';
  result: SendSmsResult;
};

export type PreflightProceed = {
  kind: 'proceed';
  scoped: TenantScopedDb;
  toE164: string;
  finalBody: string;
  truncated: boolean;
};

export type PreflightOutcome = PreflightShortCircuit | PreflightProceed;

// why: pre-flight runs the order in the chunk-14 spec: tier-gate, then opt-out, then
// idempotency-check, then build the message + persist a `pending` row. Live and twin
// adapters both run this; only the wire call differs.
export async function preflightSend(
  input: SendSmsInput,
  deps: SendDeps,
): Promise<PreflightOutcome> {
  const scoped = db.forTenant(input.tenantId);

  // 1. tier gate
  const tenant = await db.global.tenant.findUnique({
    where: { id: input.tenantId },
    select: { plan: true },
  });
  if (!tenant || !PRO_PLUS.includes(tenant.plan)) {
    const row = await scoped.smsMessage.create({
      data: {
        clientId: input.clientId,
        appointmentId: input.appointmentId ?? null,
        direction: SmsDirection.out,
        toE164: input.toE164,
        fromE164: deps.fromNumber,
        body: '',
        status: SmsStatus.skipped_tier,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return {
      kind: 'short_circuit',
      result: { sent: false, reason: 'tier_gated', smsMessageId: row.id },
    };
  }

  // 2. opt-out gate
  const client = await scoped.client.findFirst({
    where: { id: input.clientId },
    select: { id: true, smsOptOut: true },
  });
  if (client?.smsOptOut) {
    const row = await scoped.smsMessage.create({
      data: {
        clientId: input.clientId,
        appointmentId: input.appointmentId ?? null,
        direction: SmsDirection.out,
        toE164: input.toE164,
        fromE164: deps.fromNumber,
        body: '',
        status: SmsStatus.skipped_opt_out,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return {
      kind: 'short_circuit',
      result: { sent: false, reason: 'opted_out', smsMessageId: row.id },
    };
  }

  // 3. idempotency check
  const existing = await scoped.smsMessage.findFirst({
    where: {
      idempotencyKey: input.idempotencyKey,
      status: { in: [SmsStatus.pending, SmsStatus.sent] },
    },
    select: { id: true },
  });
  if (existing) {
    return {
      kind: 'short_circuit',
      result: { sent: false, reason: 'duplicate', smsMessageId: existing.id },
    };
  }

  // 4. STOP suffix + truncation
  const { final, truncated } = withStopSuffix(input.body);
  if (truncated) {
    deps.log.warn(
      { idempotencyKey: input.idempotencyKey, originalLength: input.body.length },
      'twilio adapter: truncated outbound SMS to fit 160-char window',
    );
  }

  return { kind: 'proceed', scoped, toE164: input.toE164, finalBody: final, truncated };
}

// why: insert `pending` row + delegate to deps.doSend + update with the result. Shared
// across live + twin so the audit-row state machine is enforced in one place.
export async function persistAndSend(
  input: SendSmsInput,
  pre: PreflightProceed,
  deps: SendDeps,
): Promise<SendSmsResult> {
  const pending = await pre.scoped.smsMessage.create({
    data: {
      clientId: input.clientId,
      appointmentId: input.appointmentId ?? null,
      direction: SmsDirection.out,
      toE164: input.toE164,
      fromE164: deps.fromNumber,
      body: pre.finalBody,
      status: SmsStatus.pending,
      idempotencyKey: input.idempotencyKey,
    },
  });

  const send = await deps.doSend({
    to: input.toE164,
    from: deps.fromNumber,
    body: pre.finalBody,
  });

  if (send.ok) {
    await pre.scoped.smsMessage.update({
      where: { id: pending.id },
      data: {
        status: SmsStatus.sent,
        twilioSid: send.twilioSid,
        sentAt: new Date(),
      },
    });
    deps.log.info(
      { smsMessageId: pending.id, twilioSid: send.twilioSid, idempotencyKey: input.idempotencyKey },
      'twilio adapter: SMS sent',
    );
    return { sent: true, twilioSid: send.twilioSid, smsMessageId: pending.id };
  }

  await pre.scoped.smsMessage.update({
    where: { id: pending.id },
    data: {
      status: SmsStatus.error,
      errorMessage: send.errorMessage.slice(0, 500),
    },
  });
  deps.log.warn(
    { smsMessageId: pending.id, idempotencyKey: input.idempotencyKey, error: send.errorMessage },
    'twilio adapter: send failed',
  );
  return { sent: false, reason: 'error', smsMessageId: pending.id };
}

export async function runSendSms(input: SendSmsInput, deps: SendDeps): Promise<SendSmsResult> {
  const pre = await preflightSend(input, deps);
  if (pre.kind === 'short_circuit') return pre.result;
  return persistAndSend(input, pre, deps);
}

// why: shared signature verifier — twin and live both run on the same wire shape
// (HMAC-SHA1 of url + sorted-form-params + base64). Kept here so the webhook route
// doesn't need to care which adapter mode is configured.
export function verifyWebhookSignature(
  authToken: string,
  input: VerifyTwilioWebhookInput,
): boolean {
  const sortedKeys = Object.keys(input.params).sort();
  let base = input.url;
  for (const k of sortedKeys) base += k + input.params[k]!;
  const expected = createHmac('sha1', authToken).update(base).digest('base64');
  const expectedBuf = Buffer.from(expected, 'base64');
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(input.signature, 'base64');
  } catch {
    return false;
  }
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
