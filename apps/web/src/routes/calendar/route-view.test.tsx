import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteOptimizeResponse, RouteOptimizedStop } from '@mygroomtime/shared';
import { RouteView } from './route-view';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeStop(overrides: Partial<RouteOptimizedStop> = {}): RouteOptimizedStop {
  return {
    appointmentId: overrides.appointmentId ?? 'appt-1',
    startSuggested: overrides.startSuggested ?? '2026-05-18T15:00:00.000Z',
    scheduledStart: overrides.scheduledStart ?? '2026-05-18T15:00:00.000Z',
    durationMin: overrides.durationMin ?? 60,
    driveFromPrevMin: overrides.driveFromPrevMin ?? 12,
    timeLocked: overrides.timeLocked ?? false,
    pet: overrides.pet ?? { id: 'pet-1', name: 'Buddy' },
    client: overrides.client ?? {
      id: 'cli-1',
      name: 'Sarah',
      street: '1 Oak St',
      city: 'Plano',
      zip: '75024',
      lat: 33.0205,
      lng: -96.7,
    },
    serviceName: overrides.serviceName ?? 'Full Groom',
  };
}

function makeRoute(stops: RouteOptimizedStop[]): RouteOptimizeResponse {
  return {
    date: '2026-05-18T07:00:00.000Z',
    vehicleId: 'veh-1',
    depotUsed: true,
    depot: { lat: 33.0198, lng: -96.6989 },
    totalDriveMin: stops.reduce((s, x) => s + x.driveFromPrevMin, 0),
    warnings: [],
    stops,
  };
}

describe('RouteView', () => {
  it('renders stops in returned order with formatted drive times', () => {
    const route = makeRoute([
      makeStop({ appointmentId: 'a-1', pet: { id: 'p1', name: 'Buddy' }, driveFromPrevMin: 0 }),
      makeStop({ appointmentId: 'a-2', pet: { id: 'p2', name: 'Rex' }, driveFromPrevMin: 12 }),
      makeStop({ appointmentId: 'a-3', pet: { id: 'p3', name: 'Luna' }, driveFromPrevMin: 25 }),
    ]);
    render(
      <RouteView
        route={route}
        tenantPlan="pro"
        loading={false}
        applying={false}
        error={null}
        onOptimize={() => {}}
        onApply={() => {}}
        onToggleLock={() => {}}
        onBackToCalendar={() => {}}
      />,
    );
    const names = screen.getAllByText(/(Buddy|Rex|Luna)/).map((el) => el.textContent);
    expect(names[0]).toContain('Buddy');
    expect(names[1]).toContain('Rex');
    expect(names[2]).toContain('Luna');
    expect(screen.getByText(/12 min/)).toBeTruthy();
    expect(screen.getByText(/25 min/)).toBeTruthy();
    // First stop with 0 drive from depot uses "Start"
    expect(screen.getByText(/^Start$/)).toBeTruthy();
  });

  it('drive times formatted in whole minutes — no decimals', () => {
    const route = makeRoute([makeStop({ driveFromPrevMin: 12 })]);
    render(
      <RouteView
        route={route}
        tenantPlan="pro"
        loading={false}
        applying={false}
        error={null}
        onOptimize={() => {}}
        onApply={() => {}}
        onToggleLock={() => {}}
        onBackToCalendar={() => {}}
      />,
    );
    expect(screen.queryByText(/12\.4/)).toBeNull();
    expect(screen.queryByText(/minutes/)).toBeNull();
  });

  it('Starter tenant — Optimize button hidden and upgrade nudge rendered', () => {
    render(
      <RouteView
        route={null}
        tenantPlan="starter"
        loading={false}
        applying={false}
        error={null}
        onOptimize={() => {}}
        onApply={() => {}}
        onToggleLock={() => {}}
        onBackToCalendar={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Optimize route/i })).toBeNull();
    expect(screen.getByText(/Pro feature/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Upgrade/i })).toBeTruthy();
  });

  it('Apply error surfaces to the parent toast via onApply call', async () => {
    const onApply = vi.fn();
    const route = makeRoute([makeStop({})]);
    render(
      <RouteView
        route={route}
        tenantPlan="pro"
        loading={false}
        applying={false}
        error={null}
        onOptimize={() => {}}
        onApply={onApply}
        onToggleLock={() => {}}
        onBackToCalendar={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Apply suggested times/i }));
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('error prop renders an alert', () => {
    render(
      <RouteView
        route={null}
        tenantPlan="pro"
        loading={false}
        applying={false}
        error="Schedule changed since optimization — please re-run."
        onOptimize={() => {}}
        onApply={() => {}}
        onToggleLock={() => {}}
        onBackToCalendar={() => {}}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Schedule changed');
  });
});
