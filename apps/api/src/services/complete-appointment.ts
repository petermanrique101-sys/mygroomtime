import { db, AppointmentStatus, type Appointment, type Client, type Pet } from '@mygroomtime/db';
import type { StripeAdapter } from '../adapters/stripe/index.js';
import { assertTransitionAllowed, TransitionError } from './status-transitions.js';

export type CompleteAppointmentInput = {
  appointmentId: string;
  tenantId: string;
  tipCents: number;
  stripe: StripeAdapter;
};

type ApptWithRels = Appointment & { client: Client; pet: Pet };

export type CompleteAppointmentOutcome =
  | {
      ok: true;
      appointment: ApptWithRels;
      finalAmountCents: number;
      balanceChargeId: string | null;
      alreadyCompleted: boolean;
    }
  | {
      ok: false;
      reason: 'not_found' | 'invalid_transition' | 'balance_capture_failed';
      message: string;
    };

const MIN_TIP_CENTS = 0;
const MAX_TIP_CENTS = 100_000;

function clampTip(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const n = Math.round(raw);
  if (n < MIN_TIP_CENTS) return MIN_TIP_CENTS;
  if (n > MAX_TIP_CENTS) return MAX_TIP_CENTS;
  return n;
}

async function loadAppt(
  tenantId: string,
  appointmentId: string,
): Promise<ApptWithRels | null> {
  const scoped = db.forTenant(tenantId);
  const row = (await scoped.appointment.findFirst({
    where: { id: appointmentId },
    include: { client: true, pet: true },
  })) as ApptWithRels | null;
  return row;
}

export async function completeAppointment(
  input: CompleteAppointmentInput,
): Promise<CompleteAppointmentOutcome> {
  const tip = clampTip(input.tipCents);
  const existing = await loadAppt(input.tenantId, input.appointmentId);
  if (!existing) {
    return { ok: false, reason: 'not_found', message: 'Appointment not found.' };
  }

  // Idempotency: same-state return for already-completed rows.
  if (existing.status === AppointmentStatus.completed) {
    return {
      ok: true,
      appointment: existing,
      finalAmountCents: existing.finalAmountCents ?? existing.servicePriceCentsSnapshot,
      balanceChargeId: existing.balanceChargeId ?? null,
      alreadyCompleted: true,
    };
  }

  try {
    assertTransitionAllowed(existing.status, AppointmentStatus.completed);
  } catch (err) {
    if (err instanceof TransitionError) {
      return {
        ok: false,
        reason: 'invalid_transition',
        message: `Cannot complete an appointment in status ${existing.status}.`,
      };
    }
    throw err;
  }

  const finalAmountCents = existing.servicePriceCentsSnapshot + tip;
  let balanceChargeId: string | null = null;

  if (existing.depositChargeId) {
    // why: a publicly-booked appointment captured a deposit on the connected account at
    // submit-time. Balance = (price - deposit + tip). We use idempotency key
    // `complete-{id}` so an accidental double-tap on Complete only fires one PI.
    // TODO chunk-22: extend createPaymentIntent for off_session+confirm on live mode.
    // For v1 the twin records the PI; the live wire payment will need that flag.
    const balanceCents = existing.servicePriceCentsSnapshot - existing.serviceDepositCentsSnapshot + tip;
    if (balanceCents > 0) {
      const tenantRow = await db.global.tenant.findUnique({
        where: { id: input.tenantId },
        select: { stripeConnectAccountId: true },
      });
      if (!tenantRow?.stripeConnectAccountId) {
        return {
          ok: false,
          reason: 'balance_capture_failed',
          message: 'No connected account on file — cannot capture the balance.',
        };
      }
      try {
        const pi = await input.stripe.createPaymentIntent({
          amountCents: balanceCents,
          currency: 'usd',
          connectedAccountId: tenantRow.stripeConnectAccountId,
          metadata: {
            tenantId: input.tenantId,
            appointmentId: existing.id,
            depositChargeId: existing.depositChargeId,
            kind: 'balance',
          },
          idempotencyKey: `complete-${existing.id}`,
        });
        balanceChargeId = pi.id;
        if (input.stripe.mode === 'twin') {
          // why: in twin mode the PI is created but not auto-confirmed. We confirm it
          // explicitly so tests see a `succeeded` status, matching what off-session
          // confirm does in real Stripe.
          await input.stripe.confirmTwinPaymentIntent({ paymentIntentId: pi.id });
        }
      } catch (err) {
        return {
          ok: false,
          reason: 'balance_capture_failed',
          message:
            err instanceof Error
              ? `Balance capture failed: ${err.message}`
              : 'Balance capture failed.',
        };
      }
    }
  }

  const scoped = db.forTenant(input.tenantId);
  const updated = (await scoped.appointment.update({
    where: { id: existing.id },
    data: {
      status: AppointmentStatus.completed,
      completedAt: new Date(),
      tipCents: tip,
      finalAmountCents,
      balanceChargeId: balanceChargeId ?? existing.balanceChargeId ?? null,
    },
  })) as Appointment;
  const hydrated = await loadAppt(input.tenantId, updated.id);
  if (!hydrated) {
    return {
      ok: false,
      reason: 'not_found',
      message: 'Appointment disappeared after completion.',
    };
  }
  return {
    ok: true,
    appointment: hydrated,
    finalAmountCents,
    balanceChargeId: hydrated.balanceChargeId,
    alreadyCompleted: false,
  };
}
