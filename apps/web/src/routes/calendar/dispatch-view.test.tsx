import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppointmentOutput, VehicleOutput } from '@mygroomtime/shared';
import { DispatchView } from './dispatch-view';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeVehicle(overrides: Partial<VehicleOutput>): VehicleOutput {
  return {
    id: 'v1',
    name: 'Van 1',
    assignedGroomerId: 'u1',
    assignedGroomerName: 'Maria',
    assignedGroomerEmail: 'maria@test',
    active: true,
    deletedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAppt(overrides: Partial<AppointmentOutput>): AppointmentOutput {
  return {
    id: 'a1',
    status: 'scheduled',
    start: '2026-05-18T10:00:00.000Z',
    end: '2026-05-18T11:00:00.000Z',
    durationMin: 60,
    petId: 'p1',
    serviceId: 's1',
    vehicleId: 'v1',
    groomerId: 'u1',
    recurringSeriesId: null,
    recurringSeriesActive: null,
    serviceNameSnapshot: 'Bath',
    servicePriceCentsSnapshot: 5000,
    serviceDepositCentsSnapshot: 0,
    serviceColorSnapshot: '#2563eb',
    serviceDurationMinSnapshot: 60,
    addressOverride: null,
    notes: '',
    timeLocked: false,
    canceledAt: null,
    onTheWayAt: null,
    startedAt: null,
    completedAt: null,
    noShowAt: null,
    tipCents: 0,
    finalAmountCents: null,
    balanceChargeId: null,
    depositChargeId: null,
    createdAt: '2026-05-18T08:00:00.000Z',
    updatedAt: '2026-05-18T08:00:00.000Z',
    pet: { id: 'p1', name: 'Rex', breed: 'Lab' },
    client: {
      id: 'c1',
      name: 'Sarah',
      phone: '+15555550100',
      street: '1 Oak St',
      city: 'Plano',
      state: 'TX',
      zip: '75024',
      lat: null,
      lng: null,
    },
    ...overrides,
  };
}

describe('DispatchView', () => {
  it('renders one column per active vehicle', () => {
    const vehicles = [
      makeVehicle({ id: 'v1', name: 'Van 1' }),
      makeVehicle({ id: 'v2', name: 'Van 2', assignedGroomerName: 'Jose' }),
      makeVehicle({ id: 'v3', name: 'Van 3', assignedGroomerName: null }),
    ];
    render(
      <MemoryRouter>
        <DispatchView
          day={new Date('2026-05-18T00:00:00Z')}
          vehicles={vehicles}
          appointments={[]}
          buffers={new Map()}
          now={new Date('2026-05-18T09:00:00Z')}
          onTapSlot={() => undefined}
          onTapAppointment={() => undefined}
          onMoveAttempt={() => undefined}
          validateProposal={() => ({ ok: true })}
          onReassign={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('dispatch-column-v1')).toBeTruthy();
    expect(screen.getByTestId('dispatch-column-v2')).toBeTruthy();
    expect(screen.getByTestId('dispatch-column-v3')).toBeTruthy();
    expect(screen.getByText('Van 1')).toBeTruthy();
    expect(screen.getByText('Maria')).toBeTruthy();
    expect(screen.getByText('Jose')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('soft-deleted/inactive vehicles are excluded from the column set', () => {
    const vehicles = [
      makeVehicle({ id: 'v1', name: 'Van 1' }),
      makeVehicle({ id: 'v2', name: 'Van 2', active: false }),
      makeVehicle({ id: 'v3', name: 'Van 3', deletedAt: '2026-05-01T00:00:00.000Z' }),
    ];
    render(
      <MemoryRouter>
        <DispatchView
          day={new Date('2026-05-18T00:00:00Z')}
          vehicles={vehicles}
          appointments={[]}
          buffers={new Map()}
          now={new Date('2026-05-18T09:00:00Z')}
          onTapSlot={() => undefined}
          onTapAppointment={() => undefined}
          onMoveAttempt={() => undefined}
          validateProposal={() => ({ ok: true })}
          onReassign={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('dispatch-column-v1')).toBeTruthy();
    expect(screen.queryByTestId('dispatch-column-v2')).toBeNull();
    expect(screen.queryByTestId('dispatch-column-v3')).toBeNull();
  });

  it('tapping an appointment opens the move sheet; tapping another vehicle fires onReassign', async () => {
    const onReassign = vi.fn();
    const vehicles = [
      makeVehicle({ id: 'v1' }),
      makeVehicle({ id: 'v2', name: 'Van 2', assignedGroomerName: 'Jose' }),
    ];
    // why: isSameDay uses local-date components. Build the test day + appointment start
    // in local time so the dayAppts filter doesn't drop the row on a non-UTC machine.
    const day = new Date(2026, 4, 18); // 2026-05-18 local midnight
    const apptStart = new Date(2026, 4, 18, 10, 0, 0);
    const apptEnd = new Date(apptStart.getTime() + 60 * 60_000);
    const appt = makeAppt({
      id: 'a1',
      vehicleId: 'v1',
      start: apptStart.toISOString(),
      end: apptEnd.toISOString(),
    });
    render(
      <MemoryRouter>
        <DispatchView
          day={day}
          vehicles={vehicles}
          appointments={[appt]}
          buffers={
            new Map([
              ['a1', { appointmentId: 'a1', beforeBufferMin: 0, afterBufferMin: 0 }],
            ])
          }
          now={new Date(2026, 4, 18, 9, 0, 0)}
          onTapSlot={() => undefined}
          onTapAppointment={() => undefined}
          onMoveAttempt={() => undefined}
          validateProposal={() => ({ ok: true })}
          onReassign={onReassign}
        />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const apptButton = screen.getByText('Rex');
    await user.click(apptButton);
    const moveTarget = await screen.findByTestId('reassign-to-v2');
    await user.click(moveTarget);
    expect(onReassign).toHaveBeenCalledWith('a1', 'v2');
  });
});
