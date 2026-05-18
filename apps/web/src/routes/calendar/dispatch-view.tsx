import { useMemo, useState } from 'react';
import type { AppointmentOutput, VehicleOutput } from '@mygroomtime/shared';
import { TimeAxis } from './time-axis';
import { DayGrid } from './day-grid';
import { isSameDay } from './date-nav';
import type { BufferLookup, ConflictCheck } from './drag-zones';

type Props = {
  day: Date;
  vehicles: VehicleOutput[];
  appointments: AppointmentOutput[];
  buffers: BufferLookup;
  now: Date;
  onTapSlot: (slotStart: Date, vehicleId: string) => void;
  onTapAppointment: (a: AppointmentOutput) => void;
  onMoveAttempt: (id: string, proposedStart: Date, check: ConflictCheck) => void;
  validateProposal: (id: string, proposedStart: Date) => ConflictCheck;
  onReassign: (appointmentId: string, vehicleId: string) => void;
};

// why: chunk-21 dispatch view. One column per vehicle. Within-column drag reuses the
// chunk-9 DayGrid drag mechanics. Cross-column reassignment uses a tap-to-move affordance
// (the "Move to" menu on each block) — same server PATCH path with `vehicleId` included.
// The spec calls out: usable on phone (375x812) via horizontal column scroll. We render
// columns side-by-side with min-width so phones get a swipe-able row.
export function DispatchView(props: Props): JSX.Element {
  const activeVehicles = useMemo(
    () => props.vehicles.filter((v) => v.active && v.deletedAt === null),
    [props.vehicles],
  );
  const dayAppts = useMemo(
    () => props.appointments.filter((a) => isSameDay(new Date(a.start), props.day)),
    [props.appointments, props.day],
  );

  if (activeVehicles.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-gray-600">
        No active vehicles yet. Add one in{' '}
        <a className="underline" href="/settings/vehicles">
          Settings → Vehicles
        </a>
        .
      </div>
    );
  }

  return (
    <div className="flex w-full">
      <TimeAxis />
      <div className="flex flex-1 snap-x snap-mandatory overflow-x-auto">
        {activeVehicles.map((vehicle) => (
          <VehicleColumn
            key={vehicle.id}
            vehicle={vehicle}
            allVehicles={activeVehicles}
            day={props.day}
            appointments={dayAppts.filter((a) => a.vehicleId === vehicle.id)}
            buffers={props.buffers}
            now={props.now}
            onTapSlot={(d) => props.onTapSlot(d, vehicle.id)}
            onTapAppointment={props.onTapAppointment}
            onMoveAttempt={props.onMoveAttempt}
            validateProposal={props.validateProposal}
            onReassign={props.onReassign}
          />
        ))}
      </div>
    </div>
  );
}

type ColumnProps = {
  vehicle: VehicleOutput;
  allVehicles: VehicleOutput[];
  day: Date;
  appointments: AppointmentOutput[];
  buffers: BufferLookup;
  now: Date;
  onTapSlot: (slotStart: Date) => void;
  onTapAppointment: (a: AppointmentOutput) => void;
  onMoveAttempt: (id: string, proposedStart: Date, check: ConflictCheck) => void;
  validateProposal: (id: string, proposedStart: Date) => ConflictCheck;
  onReassign: (appointmentId: string, vehicleId: string) => void;
};

function VehicleColumn(props: ColumnProps): JSX.Element {
  const [reassignFor, setReassignFor] = useState<AppointmentOutput | null>(null);

  function handleTapAppointment(a: AppointmentOutput): void {
    setReassignFor(a);
  }

  return (
    <div
      className="relative flex min-w-[220px] flex-1 snap-start flex-col border-r border-gray-100 last:border-r-0"
      data-testid={`dispatch-column-${props.vehicle.id}`}
    >
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-2 py-2">
        <div className="truncate text-sm font-semibold">{props.vehicle.name}</div>
        <div className="truncate text-[11px] text-gray-500">
          {props.vehicle.assignedGroomerName ?? 'Unassigned'}
        </div>
      </div>
      <div className="flex-1">
        <DayGrid
          day={props.day}
          appointments={props.appointments}
          buffers={props.buffers}
          now={props.now}
          onTapSlot={props.onTapSlot}
          onTapAppointment={handleTapAppointment}
          onMoveAttempt={props.onMoveAttempt}
          validateProposal={props.validateProposal}
        />
      </div>
      {reassignFor ? (
        <ReassignSheet
          appointment={reassignFor}
          vehicles={props.allVehicles}
          onClose={() => setReassignFor(null)}
          onView={(a) => {
            setReassignFor(null);
            props.onTapAppointment(a);
          }}
          onReassign={(vehicleId) => {
            props.onReassign(reassignFor.id, vehicleId);
            setReassignFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ReassignSheet(props: {
  appointment: AppointmentOutput;
  vehicles: VehicleOutput[];
  onClose: () => void;
  onView: (a: AppointmentOutput) => void;
  onReassign: (vehicleId: string) => void;
}): JSX.Element {
  const a = props.appointment;
  const others = props.vehicles.filter((v) => v.id !== a.vehicleId);
  return (
    <div
      role="dialog"
      aria-label="Move appointment"
      className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border border-gray-200 bg-white p-4 shadow-xl"
    >
      <div className="mx-auto max-w-md">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div className="text-base font-semibold">{a.pet.name}</div>
            <div className="text-xs text-gray-500">{a.serviceNameSnapshot}</div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md px-2 py-1 text-xs text-gray-500"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <button
          type="button"
          onClick={() => props.onView(a)}
          className="mb-2 block w-full rounded-md border border-gray-300 bg-white py-2 text-sm font-medium"
        >
          Open details
        </button>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          Move to vehicle
        </div>
        <ul className="space-y-2">
          {others.length === 0 ? (
            <li className="text-sm text-gray-500">Only one active vehicle.</li>
          ) : (
            others.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  data-testid={`reassign-to-${v.id}`}
                  onClick={() => props.onReassign(v.id)}
                  className="flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium"
                >
                  <span>{v.name}</span>
                  <span className="text-xs text-gray-500">
                    {v.assignedGroomerName ?? 'Unassigned'}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
