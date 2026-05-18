import { useEffect, useState } from 'react';
import type { AppointmentOutput } from '@mygroomtime/shared';
import { centsToDollarString } from '../settings/money';
import {
  CompletedSummary,
  StatusActionBar,
  TerminalBadge,
} from './status-action-bar';
import { NoShowConfirm } from './no-show-confirm';

type Props = {
  appointment: AppointmentOutput | null;
  onClose: () => void;
  onCancel: (id: string) => void;
  onSaveNotes: (id: string, notes: string) => Promise<void>;
  onMarkOnTheWay: (id: string) => void;
  onMarkStarted: (id: string) => void;
  onMarkNoShow: (id: string) => void;
  onOpenComplete: (a: AppointmentOutput) => void;
  onOpenRebook: (a: AppointmentOutput) => void;
  busy: boolean;
};

function initialFor(name: string): string {
  const t = name.trim();
  if (t.length === 0) return '?';
  return t[0]!.toUpperCase();
}

function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString([], opts)} – ${end.toLocaleTimeString([], opts)}`;
}

export function DetailDrawer({
  appointment,
  onClose,
  onCancel,
  onSaveNotes,
  onMarkOnTheWay,
  onMarkStarted,
  onMarkNoShow,
  onOpenComplete,
  onOpenRebook,
  busy,
}: Props): JSX.Element | null {
  const [notes, setNotes] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingNoShow, setConfirmingNoShow] = useState(false);

  useEffect(() => {
    if (appointment) {
      setNotes(appointment.notes);
      setEditingNotes(false);
      setConfirmingCancel(false);
      setConfirmingNoShow(false);
    }
  }, [appointment?.id, appointment?.notes]);

  if (!appointment) return null;
  const addr = appointment.addressOverride ?? {
    street: appointment.client.street,
    city: appointment.client.city,
    state: appointment.client.state,
    zip: appointment.client.zip,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Appointment detail"
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 md:items-center"
    >
      <div className="flex max-h-[95vh] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl bg-white md:max-h-[90vh] md:rounded-2xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <h2 className="text-base font-semibold tracking-tight">Appointment</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg px-3 text-sm text-gray-600"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-4 py-4 text-sm text-gray-800">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white"
              style={{ backgroundColor: appointment.serviceColorSnapshot }}
              aria-hidden="true"
            >
              {initialFor(appointment.pet.name)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{appointment.pet.name}</div>
              <div className="truncate text-xs text-gray-500">{appointment.pet.breed}</div>
            </div>
          </div>

          <Row label="Client">
            <div className="font-medium">{appointment.client.name}</div>
            <a
              href={`tel:${appointment.client.phone}`}
              className="block min-h-[44px] text-xs text-gray-500 underline"
            >
              {appointment.client.phone}
            </a>
          </Row>

          <Row label="Service">
            <div className="font-medium">{appointment.serviceNameSnapshot}</div>
            <div className="text-xs text-gray-500">
              ${centsToDollarString(appointment.servicePriceCentsSnapshot)} ·{' '}
              {appointment.serviceDurationMinSnapshot} min
            </div>
          </Row>

          <Row label="Time">
            <div className="font-medium">{formatTimeRange(appointment.start, appointment.end)}</div>
            <div className="text-xs text-gray-500">
              {new Date(appointment.start).toLocaleDateString()}
            </div>
          </Row>

          <Row label="Address">
            <div>
              {addr.street}
              <br />
              {addr.city}, {addr.state} {addr.zip}
              {appointment.addressOverride ? (
                <div className="mt-1 text-xs text-amber-700">
                  Override{' '}
                  {appointment.addressOverride.verified ? '· verified' : '· unverified'}
                </div>
              ) : null}
            </div>
          </Row>

          <Row label="Notes">
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      await onSaveNotes(appointment.id, notes);
                      setEditingNotes(false);
                    }}
                    className="min-h-[44px] rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNotes(appointment.notes);
                      setEditingNotes(false);
                    }}
                    className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="whitespace-pre-wrap text-sm">{appointment.notes || '—'}</p>
                <button
                  type="button"
                  onClick={() => setEditingNotes(true)}
                  className="mt-1 min-h-[44px] text-xs text-gray-600 underline"
                >
                  Edit notes
                </button>
              </div>
            )}
          </Row>

          {appointment.status === 'completed' ? (
            <CompletedSummary
              completedAt={appointment.completedAt}
              finalAmountCents={appointment.finalAmountCents}
              onRebook={() => onOpenRebook(appointment)}
              busy={busy}
            />
          ) : appointment.status === 'canceled' || appointment.status === 'no_show' ? (
            <TerminalBadge
              status={appointment.status}
              noShowAt={appointment.noShowAt}
              canceledAt={appointment.canceledAt}
            />
          ) : confirmingNoShow ? (
            <NoShowConfirm
              petName={appointment.pet.name}
              depositCents={appointment.serviceDepositCentsSnapshot}
              busy={busy}
              onConfirm={() => onMarkNoShow(appointment.id)}
              onCancel={() => setConfirmingNoShow(false)}
            />
          ) : confirmingCancel ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm">
              <p className="mb-2 font-medium text-red-800">
                {appointment.serviceDepositCentsSnapshot > 0
                  ? `Cancel this appointment? The $${centsToDollarString(appointment.serviceDepositCentsSnapshot)} deposit will be refunded to the customer.`
                  : 'Cancel this appointment? No deposit was collected.'}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onCancel(appointment.id)}
                  className="min-h-[44px] rounded-lg bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Yes, cancel
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm text-gray-700"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <StatusActionBar
              status={appointment.status}
              busy={busy}
              onOnTheWay={() => onMarkOnTheWay(appointment.id)}
              onStarted={() => onMarkStarted(appointment.id)}
              onComplete={() => onOpenComplete(appointment)}
              onNoShow={() => setConfirmingNoShow(true)}
              onCancel={() => setConfirmingCancel(true)}
              onRebook={() => onOpenRebook(appointment)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div>{children}</div>
    </div>
  );
}
