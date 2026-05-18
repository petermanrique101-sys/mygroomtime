import {
  AppointmentStatus,
  db,
  SmsDirection,
  SmsStatus,
  type Appointment,
  type Client,
  type SmsMessage,
} from '@mygroomtime/db';
import type { TwilioAdapter } from '../adapters/twilio/index.js';
import type { SessionStore } from '../adapters/session/index.js';
import { tenDigitSuffix, toDialFormat } from './phone.js';
import { issueRescheduleToken } from './reschedule-tokens.js';
import { formatAppointmentDateTime } from './format-datetime.js';

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const CONFIRM_WORDS = new Set(['C', 'Y', 'YES']);
const RESCHEDULE_EXACT = new Set(['R']);
// why: free-form text is matched case-insensitively against the substring RESCHEDULE.
// "R" alone is the exact-match path; substring "RESCHEDULE" lets longer replies match too.
// Order matters — STOP / UNSUBSCRIBE / CANCEL substring would catch "Reply CANCEL" if a
// dispatcher branch tried partial matching for the STOP set. We keep STOP exact-trimmed.
const RESCHEDULE_SUBSTR = 'RESCHEDULE';

export type DispatchInput = {
  from: string;
  to: string;
  body: string;
  messageSid: string;
};

export type DispatchAction =
  | 'opted_out'
  | 'opted_in'
  | 'reschedule_link_sent'
  | 'reschedule_no_match'
  | 'confirmation_logged'
  | 'fallback_sent'
  | 'no_match';

export type DispatchOutcome = {
  action: DispatchAction;
  detail?: string;
  matchedTenantIds: string[];
};

export type DispatchDeps = {
  twilio: TwilioAdapter;
  sessionStore: SessionStore;
  rescheduleTokenSecret: string;
  webOrigin: string;
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
};

type TenantMatch = {
  id: string;
  slug: string;
  phone: string | null;
  client: Client;
};

async function findTenantMatches(from: string): Promise<TenantMatch[]> {
  const suffix = tenDigitSuffix(from);
  if (suffix.length !== 10) return [];
  const tenants = await db.global.tenant.findMany({
    where: {
      clients: {
        some: { phone: { endsWith: suffix }, deletedAt: null },
      },
    },
    select: {
      id: true,
      slug: true,
      phone: true,
      clients: {
        where: { phone: { endsWith: suffix }, deletedAt: null },
        take: 1,
      },
    },
  });
  const matches: TenantMatch[] = [];
  for (const t of tenants) {
    const c = t.clients[0];
    if (c) matches.push({ id: t.id, slug: t.slug, phone: t.phone, client: c as Client });
  }
  return matches;
}

async function logInbound(
  tenantId: string,
  clientId: string,
  appointmentId: string | null,
  to: string,
  from: string,
  body: string,
): Promise<void> {
  const scoped = db.forTenant(tenantId);
  await scoped.smsMessage.create({
    data: {
      clientId,
      appointmentId,
      direction: SmsDirection.in,
      toE164: to,
      fromE164: from,
      body,
      status: SmsStatus.sent,
    },
  });
}

async function findRecentReminderAppointment(
  tenantId: string,
  clientId: string,
): Promise<Appointment | null> {
  const scoped = db.forTenant(tenantId);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // why: prefer the most recent reminder-related outbound SMS within 30 days. We exclude
  // post-appointment-review SMS (idempotency key starts with `reminder-post:`) because the
  // appointment is already past — reschedule on a completed appt is nonsensical for v1.
  const sms = (await scoped.smsMessage.findFirst({
    where: {
      clientId,
      direction: SmsDirection.out,
      status: SmsStatus.sent,
      appointmentId: { not: null },
      createdAt: { gte: cutoff },
      idempotencyKey: { not: { startsWith: 'reminder-post:' } },
    },
    orderBy: { createdAt: 'desc' },
  })) as SmsMessage | null;
  if (sms?.appointmentId) {
    return (await scoped.appointment.findFirst({
      where: { id: sms.appointmentId },
    })) as Appointment | null;
  }
  // why: if no SMS row matched (e.g., we sent confirmations only), fall back to the most
  // recent scheduled (or completed) future appointment in the last 30 days as a best-effort.
  return (await scoped.appointment.findFirst({
    where: {
      clientId,
      status: AppointmentStatus.scheduled,
      scheduledStart: { gte: new Date() },
    },
    orderBy: { scheduledStart: 'asc' },
  })) as Appointment | null;
}

async function sendReply(
  deps: DispatchDeps,
  tenantId: string,
  clientId: string,
  appointmentId: string | null,
  fromE164: string,
  body: string,
  idempotencyKey: string,
): Promise<void> {
  const dial = toDialFormat(fromE164);
  if (!dial) return;
  await deps.twilio.sendSms({
    toE164: dial,
    body,
    idempotencyKey,
    tenantId,
    clientId,
    appointmentId: appointmentId ?? undefined,
  });
}

async function handleOptOut(
  deps: DispatchDeps,
  matches: TenantMatch[],
  input: DispatchInput,
): Promise<DispatchOutcome> {
  const now = new Date();
  for (const m of matches) {
    const scoped = db.forTenant(m.id);
    await scoped.client.update({
      where: { id: m.client.id },
      data: { smsOptOut: true, smsOptOutAt: now },
    });
    await logInbound(m.id, m.client.id, null, input.to, input.from, input.body);
  }
  deps.log.info(
    { messageSid: input.messageSid, matchedTenants: matches.length },
    'inbound dispatch: opt-out applied',
  );
  return { action: 'opted_out', matchedTenantIds: matches.map((m) => m.id) };
}

async function handleOptIn(
  deps: DispatchDeps,
  matches: TenantMatch[],
  input: DispatchInput,
): Promise<DispatchOutcome> {
  for (const m of matches) {
    const scoped = db.forTenant(m.id);
    await scoped.client.update({
      where: { id: m.client.id },
      data: { smsOptOut: false, smsOptOutAt: null },
    });
    await logInbound(m.id, m.client.id, null, input.to, input.from, input.body);
  }
  deps.log.info(
    { messageSid: input.messageSid, matchedTenants: matches.length },
    'inbound dispatch: opt-in applied',
  );
  return { action: 'opted_in', matchedTenantIds: matches.map((m) => m.id) };
}

async function handleReschedule(
  deps: DispatchDeps,
  matches: TenantMatch[],
  input: DispatchInput,
): Promise<DispatchOutcome> {
  // why: a single phone may map to multiple tenants. We send a reschedule link per match,
  // so each groomer's customer-of-record sees the right URL. This matches how STOP/START
  // are applied across all matched tenants.
  let linkedCount = 0;
  for (const m of matches) {
    const appt = await findRecentReminderAppointment(m.id, m.client.id);
    await logInbound(m.id, m.client.id, appt?.id ?? null, input.to, input.from, input.body);
    if (!appt) {
      const fallback = m.phone
        ? `We couldn't find a recent appointment to reschedule. Please call ${m.phone}.`
        : `We couldn't find a recent appointment to reschedule. Please contact the groomer.`;
      await sendReply(
        deps,
        m.id,
        m.client.id,
        null,
        input.from,
        fallback,
        `reschedule-nomatch:${input.messageSid}:${m.id}`,
      );
      continue;
    }
    const { url } = await issueRescheduleToken({
      appointmentId: appt.id,
      tenantId: m.id,
      scheduledStart: appt.scheduledStart,
      webOrigin: deps.webOrigin,
      tenantSlug: m.slug,
      secret: deps.rescheduleTokenSecret,
      sessionStore: deps.sessionStore,
    });
    await sendReply(
      deps,
      m.id,
      m.client.id,
      appt.id,
      input.from,
      `Tap to pick a new time: ${url}`,
      `reschedule-link:${input.messageSid}:${m.id}`,
    );
    linkedCount += 1;
  }
  return {
    action: linkedCount > 0 ? 'reschedule_link_sent' : 'reschedule_no_match',
    matchedTenantIds: matches.map((m) => m.id),
  };
}

async function handleConfirm(
  deps: DispatchDeps,
  matches: TenantMatch[],
  input: DispatchInput,
): Promise<DispatchOutcome> {
  for (const m of matches) {
    const appt = await findRecentReminderAppointment(m.id, m.client.id);
    await logInbound(m.id, m.client.id, appt?.id ?? null, input.to, input.from, input.body);
    if (!appt) continue;
    const body = `Thanks! See you ${formatAppointmentDateTime(appt.scheduledStart)}.`;
    await sendReply(
      deps,
      m.id,
      m.client.id,
      appt.id,
      input.from,
      body,
      `confirm-reply:${input.messageSid}:${m.id}`,
    );
  }
  return {
    action: 'confirmation_logged',
    matchedTenantIds: matches.map((m) => m.id),
  };
}

async function handleFallback(
  deps: DispatchDeps,
  matches: TenantMatch[],
  input: DispatchInput,
): Promise<DispatchOutcome> {
  for (const m of matches) {
    await logInbound(m.id, m.client.id, null, input.to, input.from, input.body);
    const phoneTail = m.phone ? ` or call ${m.phone}` : '';
    const fallback = `Sorry — we didn't catch that. Reply C to confirm, R to reschedule${phoneTail}.`;
    await sendReply(
      deps,
      m.id,
      m.client.id,
      null,
      input.from,
      fallback,
      `fallback:${input.messageSid}:${m.id}`,
    );
  }
  return { action: 'fallback_sent', matchedTenantIds: matches.map((m) => m.id) };
}

export async function dispatchInbound(
  input: DispatchInput,
  deps: DispatchDeps,
): Promise<DispatchOutcome> {
  const trimmed = input.body.trim();
  const upper = trimmed.toUpperCase();
  const matches = await findTenantMatches(input.from);

  if (matches.length === 0) {
    deps.log.info({ messageSid: input.messageSid }, 'inbound dispatch: no client matched');
    return { action: 'no_match', matchedTenantIds: [] };
  }

  // 1. STOP (highest priority, exact-trimmed-body match)
  if (STOP_WORDS.has(upper)) return handleOptOut(deps, matches, input);

  // 2. RESCHEDULE — exact "R" OR contains RESCHEDULE anywhere
  if (RESCHEDULE_EXACT.has(upper) || upper.includes(RESCHEDULE_SUBSTR)) {
    return handleReschedule(deps, matches, input);
  }

  // 3. confirmation — exact C / Y / YES
  if (CONFIRM_WORDS.has(upper)) return handleConfirm(deps, matches, input);

  // 4. START/UNSTOP — silent opt-in (no auto-reply)
  if (upper === 'START' || upper === 'UNSTOP') return handleOptIn(deps, matches, input);

  // 5. fallback
  return handleFallback(deps, matches, input);
}
