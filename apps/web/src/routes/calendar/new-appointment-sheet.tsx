import { useEffect, useMemo, useState } from 'react';
import type {
  AppointmentAddressOverride,
  AppointmentCreateRequest,
  ClientWithPetsOutput,
  ServiceOutput,
} from '@mygroomtime/shared';
import { parseLocalDateTime, snapToSlot, toIsoLocal } from './date-nav';

type Props = {
  open: boolean;
  initialStart: Date;
  clients: ClientWithPetsOutput[];
  services: ServiceOutput[];
  submitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onSubmit: (payload: AppointmentCreateRequest) => void;
};

function isoDatePart(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoTimePart(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewAppointmentSheet({
  open,
  initialStart,
  clients,
  services,
  submitting,
  submitError,
  onClose,
  onSubmit,
}: Props): JSX.Element | null {
  const snapped = useMemo(() => snapToSlot(initialStart), [initialStart]);
  const [date, setDate] = useState(isoDatePart(snapped));
  const [time, setTime] = useState(isoTimePart(snapped));
  const [clientId, setClientId] = useState<string>('');
  const [petId, setPetId] = useState<string>('');
  const [serviceId, setServiceId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [override, setOverride] = useState<AppointmentAddressOverride>({
    street: '',
    city: 'Plano',
    state: 'TX',
    zip: '',
  });
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const s = snapToSlot(initialStart);
    setDate(isoDatePart(s));
    setTime(isoTimePart(s));
    setClientId('');
    setPetId('');
    setServiceId('');
    setNotes('');
    setOverrideEnabled(false);
    setOverride({ street: '', city: 'Plano', state: 'TX', zip: '' });
    setLocalError(null);
  }, [open, initialStart]);

  if (!open) return null;

  const activeClients = clients;
  const selectedClient = activeClients.find((c) => c.id === clientId) ?? null;
  const pets = selectedClient?.pets ?? [];
  const activeServices = services.filter((s) => s.active && s.deletedAt === null);

  function submit(): void {
    setLocalError(null);
    const parsed = parseLocalDateTime(date, time);
    if (!parsed) {
      setLocalError('Pick a valid date and time.');
      return;
    }
    if (!petId) {
      setLocalError('Pick a pet.');
      return;
    }
    if (!serviceId) {
      setLocalError('Pick a service.');
      return;
    }
    const payload: AppointmentCreateRequest = {
      petId,
      serviceId,
      start: toIsoLocal(parsed),
      ...(notes ? { notes } : {}),
      ...(overrideEnabled ? { addressOverride: override } : {}),
      mutationUuid: crypto.randomUUID(),
    };
    onSubmit(payload);
  }

  const error = localError ?? submitError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New appointment"
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 md:items-center"
    >
      <div className="flex max-h-[95vh] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl bg-white md:max-h-[90vh] md:rounded-2xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <h2 className="text-base font-semibold tracking-tight">New appointment</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg px-3 text-sm text-gray-600"
          >
            Close
          </button>
        </header>
        <div className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base"
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                value={time}
                step={900}
                onChange={(e) => setTime(e.target.value)}
                className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base"
              />
            </Field>
          </div>

          <Field label="Client">
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setPetId('');
              }}
              className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base"
            >
              <option value="">Pick a client</option>
              {activeClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          {selectedClient?.smsOptOut ? (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              This customer has opted out of SMS. They won&apos;t receive a booking confirmation or future reminders.
            </div>
          ) : null}

          <Field label="Pet">
            <select
              value={petId}
              onChange={(e) => setPetId(e.target.value)}
              disabled={!selectedClient}
              className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base disabled:opacity-50"
            >
              <option value="">{selectedClient ? 'Pick a pet' : 'Pick a client first'}</option>
              {pets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Service">
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base"
            >
              <option value="">Pick a service</option>
              {activeServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.durationMin}m
                </option>
              ))}
            </select>
          </Field>

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </Field>

          <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={overrideEnabled}
              onChange={(e) => setOverrideEnabled(e.target.checked)}
              className="h-5 w-5"
            />
            Override address for this appointment
          </label>

          {overrideEnabled ? (
            <div className="space-y-3 rounded-lg border border-gray-200 p-3">
              <Field label="Street">
                <input
                  value={override.street}
                  onChange={(e) => setOverride({ ...override, street: e.target.value })}
                  className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base"
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="City">
                    <input
                      value={override.city}
                      onChange={(e) => setOverride({ ...override, city: e.target.value })}
                      className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base"
                    />
                  </Field>
                </div>
                <Field label="State">
                  <input
                    value={override.state}
                    onChange={(e) =>
                      setOverride({ ...override, state: e.target.value.toUpperCase() })
                    }
                    className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base"
                  />
                </Field>
              </div>
              <Field label="Zip">
                <input
                  value={override.zip}
                  onChange={(e) => setOverride({ ...override, zip: e.target.value })}
                  className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base"
                />
              </Field>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Create appointment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}
