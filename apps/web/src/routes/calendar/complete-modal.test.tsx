import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppointmentOutput } from '@mygroomtime/shared';
import { CompleteModal } from './complete-modal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeAppt(overrides: Partial<AppointmentOutput> = {}): AppointmentOutput {
  return {
    id: overrides.id ?? 'appt-1',
    status: overrides.status ?? 'started',
    start: '2026-05-18T15:00:00.000Z',
    end: '2026-05-18T16:30:00.000Z',
    durationMin: 90,
    petId: 'pet-1',
    serviceId: 'svc-1',
    vehicleId: 'veh-1',
    groomerId: 'u-1',
    serviceNameSnapshot: 'Full Groom',
    servicePriceCentsSnapshot: 8500,
    serviceDepositCentsSnapshot: 2000,
    serviceColorSnapshot: '#2563eb',
    serviceDurationMinSnapshot: 90,
    addressOverride: null,
    notes: '',
    timeLocked: false,
    canceledAt: null,
    onTheWayAt: null,
    startedAt: '2026-05-18T15:00:00.000Z',
    completedAt: overrides.completedAt ?? null,
    noShowAt: null,
    tipCents: 0,
    finalAmountCents: null,
    balanceChargeId: null,
    depositChargeId: 'pi_TWIN_test',
    createdAt: '2026-05-18T10:00:00.000Z',
    updatedAt: '2026-05-18T10:00:00.000Z',
    pet: { id: 'pet-1', name: 'Buddy', breed: 'Lab' },
    client: {
      id: 'cli-1',
      name: 'Sarah',
      phone: '+19725550101',
      street: '1 Oak',
      city: 'Plano',
      state: 'TX',
      zip: '75024',
      lat: 33,
      lng: -96,
    },
    ...overrides,
  };
}

describe('CompleteModal — tip step then rebook step', () => {
  it('happy path: tap 20% → onComplete fires with tipCents; on success advance to rebook', async () => {
    const onComplete = vi.fn().mockResolvedValue(true);
    const onRebook = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(
      <CompleteModal
        appointment={makeAppt()}
        defaultIntervalWeeks={6}
        busy={false}
        completeError={null}
        rebookError={null}
        rebookConflictMessage={null}
        onComplete={onComplete}
        onRebook={onRebook}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/Add tip for Buddy/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^20%/i }));
    // 20% of $85 = $17 = 1700 cents
    expect(onComplete).toHaveBeenCalledWith(1700);

    // After complete resolves true, the modal should advance to the rebook step
    await screen.findByText(/Rebook Buddy\?/i);
  });

  it('Stripe failure surfaces error and keeps modal on tip step', async () => {
    const onComplete = vi.fn().mockResolvedValue(false);
    render(
      <CompleteModal
        appointment={makeAppt()}
        defaultIntervalWeeks={6}
        busy={false}
        completeError="Balance capture failed: card_declined"
        rebookError={null}
        rebookConflictMessage={null}
        onComplete={onComplete}
        onRebook={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^18%/i }));
    expect(onComplete).toHaveBeenCalled();
    // Still on tip step
    expect(screen.getByText(/Add tip for Buddy/i)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('card_declined');
  });

  it('Skip tip submits 0 cents', async () => {
    const onComplete = vi.fn().mockResolvedValue(true);
    render(
      <CompleteModal
        appointment={makeAppt()}
        defaultIntervalWeeks={6}
        busy={false}
        completeError={null}
        rebookError={null}
        rebookConflictMessage={null}
        onComplete={onComplete}
        onRebook={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Skip tip/i }));
    expect(onComplete).toHaveBeenCalledWith(0);
  });

  it('Tip presets do NOT pre-select — no default highlighted', () => {
    render(
      <CompleteModal
        appointment={makeAppt()}
        defaultIntervalWeeks={6}
        busy={false}
        completeError={null}
        rebookError={null}
        rebookConflictMessage={null}
        onComplete={vi.fn()}
        onRebook={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // None of the percent buttons should be aria-pressed (we never pre-select tips)
    for (const btn of screen.getAllByRole('button')) {
      expect(btn.getAttribute('aria-pressed')).not.toBe('true');
    }
  });

  it('Starts on rebook step for already-completed appointment', () => {
    render(
      <CompleteModal
        appointment={makeAppt({
          status: 'completed',
          completedAt: '2026-05-18T16:00:00.000Z',
        })}
        defaultIntervalWeeks={6}
        busy={false}
        completeError={null}
        rebookError={null}
        rebookConflictMessage={null}
        onComplete={vi.fn()}
        onRebook={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Rebook Buddy\?/i)).toBeTruthy();
    expect(screen.queryByText(/Add tip for Buddy/i)).toBeNull();
  });

  it('rebook conflict shows actionable hint, keeps modal open', async () => {
    const onRebook = vi.fn().mockResolvedValue(false);
    render(
      <CompleteModal
        appointment={makeAppt({ status: 'completed' })}
        defaultIntervalWeeks={6}
        busy={false}
        completeError={null}
        rebookError={null}
        rebookConflictMessage="That date is already booked or buffered."
        onComplete={vi.fn()}
        onRebook={onRebook}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/already booked/i);
  });
});
