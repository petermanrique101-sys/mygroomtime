import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
import type { ClientWithPetsOutput, ServiceOutput } from '@mygroomtime/shared';
import { NewAppointmentSheet } from './new-appointment-sheet';

function makeClient(overrides: Partial<ClientWithPetsOutput> = {}): ClientWithPetsOutput {
  return {
    id: overrides.id ?? 'cli-1',
    name: overrides.name ?? 'Sarah Owner',
    phone: '+19725550101',
    email: null,
    street: '1 Test Rd',
    city: 'Plano',
    state: 'TX',
    zip: '75024',
    lat: null,
    lng: null,
    addressVerified: true,
    preferredGroomerId: null,
    notes: '',
    smsOptOut: overrides.smsOptOut ?? false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pets: [
      {
        id: 'pet-1',
        clientId: overrides.id ?? 'cli-1',
        name: 'Buddy',
        breed: 'Golden Retriever',
        weightLb: 60,
        coatType: 'medium',
        temperamentNotes: '',
        preferredCutStyle: '',
        vaccinationExpiry: null,
        photoUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

function makeService(): ServiceOutput {
  return {
    id: 'svc-1',
    name: 'Full Groom',
    durationMin: 90,
    basePriceCents: 8500,
    depositCents: 2000,
    color: '#2563eb',
    active: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('NewAppointmentSheet — opt-out banner', () => {
  it('shows the banner once the picked client has smsOptOut=true', async () => {
    const user = userEvent.setup();
    render(
      <NewAppointmentSheet
        open
        initialStart={new Date(2026, 4, 17, 10, 0, 0, 0)}
        clients={[
          makeClient({ id: 'cli-ok', name: 'Has SMS', smsOptOut: false }),
          makeClient({ id: 'cli-out', name: 'Opted Out', smsOptOut: true }),
        ]}
        services={[makeService()]}
        submitting={false}
        submitError={null}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: /client/i }), 'cli-out');
    expect(screen.getByRole('status')).toHaveTextContent(/opted out of SMS/i);

    await user.selectOptions(screen.getByRole('combobox', { name: /client/i }), 'cli-ok');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not block submit when the client is opted out', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <NewAppointmentSheet
        open
        initialStart={new Date(2026, 4, 17, 10, 0, 0, 0)}
        clients={[makeClient({ id: 'cli-out', name: 'Opted Out', smsOptOut: true })]}
        services={[makeService()]}
        submitting={false}
        submitError={null}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: /client/i }), 'cli-out');
    await user.selectOptions(screen.getByRole('combobox', { name: /pet/i }), 'pet-1');
    await user.selectOptions(screen.getByRole('combobox', { name: /service/i }), 'svc-1');
    await user.click(screen.getByRole('button', { name: /create appointment/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
