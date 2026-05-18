import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VehicleOutput } from '@mygroomtime/shared';
import { useAuthOptional } from '../../lib/auth-context';
import {
  createVehicle,
  deleteVehicle,
  listVehicles,
  updateVehicle,
} from '../../lib/vehicles-api';

const VEHICLES_KEY = ['vehicles', 'settings'] as const;

export default function VehiclesSettingsRoute(): JSX.Element {
  const auth = useAuthOptional();
  const plan = auth?.session?.tenant.plan ?? 'starter';
  const isBusiness = plan === 'business';

  const qc = useQueryClient();
  const [draftName, setDraftName] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState<VehicleOutput | null>(null);

  const vehiclesQuery = useQuery({
    queryKey: VEHICLES_KEY,
    enabled: isBusiness,
    queryFn: async () => {
      const res = await listVehicles(true);
      if (!res.ok) throw new Error(res.error.message);
      return res.data.vehicles;
    },
  });

  function refresh(): void {
    void qc.invalidateQueries({ queryKey: ['vehicles'] });
  }

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      const res = await createVehicle({ name });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      setDraftName('');
      refresh();
    },
    onError: (err) => setToast((err as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await deleteVehicle(id);
      if (!res.ok) throw new Error(res.error.message);
    },
    onSuccess: () => refresh(),
    onError: (err) => setToast((err as Error).message),
  });

  if (!isBusiness) {
    return (
      <main className="min-h-screen bg-white px-4 py-6 text-gray-900">
        <div className="mx-auto max-w-md">
          <Link to="/settings" className="text-sm text-gray-600 underline">
            ← Settings
          </Link>
          <h1 className="mt-3 text-lg font-semibold">Vehicles</h1>
          <p className="mt-2 text-sm text-gray-600">
            Multi-vehicle dispatch is a Business-tier feature. Upgrade to add more vans
            and assign drivers.
          </p>
          <Link
            to="/settings/billing"
            className="mt-4 inline-block rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white"
          >
            Upgrade to Business
          </Link>
        </div>
      </main>
    );
  }

  const vehicles = vehiclesQuery.data ?? [];
  const active = vehicles.filter((v) => v.active && v.deletedAt === null);
  const deleted = vehicles.filter((v) => v.deletedAt !== null);

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <Link to="/settings" className="text-sm text-gray-600 underline">
            ← Settings
          </Link>
          <h1 className="mt-1 text-base font-semibold">Vehicles</h1>
        </header>
        <section className="flex-1 px-4 py-4">
          <form
            className="mb-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draftName.trim()) return;
              createMut.mutate(draftName.trim());
            }}
          >
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Van 2"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
              aria-label="New vehicle name"
            />
            <button
              type="submit"
              disabled={createMut.isPending || !draftName.trim()}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:bg-gray-400"
            >
              Add
            </button>
          </form>

          <ul className="space-y-2">
            {active.map((v) => (
              <li
                key={v.id}
                className="rounded-lg border border-gray-200 p-3"
                data-testid={`vehicle-row-${v.id}`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{v.name}</div>
                    <div className="truncate text-xs text-gray-500">
                      {v.assignedGroomerName ?? 'Unassigned'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(v)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Soft-delete ${v.name}?`)) deleteMut.mutate(v.id);
                    }}
                    className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-xs"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {active.length === 0 ? (
              <li className="text-sm text-gray-500">No active vehicles yet.</li>
            ) : null}
          </ul>

          {deleted.length > 0 ? (
            <details className="mt-6">
              <summary className="cursor-pointer text-xs text-gray-500">
                Deleted ({deleted.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-gray-500">
                {deleted.map((v) => (
                  <li key={v.id}>{v.name}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
        {editing ? (
          <EditSheet
            vehicle={editing}
            onClose={() => setEditing(null)}
            onSaved={(msg) => {
              setEditing(null);
              setToast(msg);
              refresh();
            }}
          />
        ) : null}
        {toast ? (
          <div
            role="status"
            className="fixed inset-x-0 bottom-4 mx-auto max-w-md rounded-lg bg-gray-900 px-4 py-2 text-sm text-white"
          >
            {toast}
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-3 underline"
            >
              dismiss
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function EditSheet(props: {
  vehicle: VehicleOutput;
  onClose: () => void;
  onSaved: (msg: string) => void;
}): JSX.Element {
  const [name, setName] = useState(props.vehicle.name);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    const res = await updateVehicle(props.vehicle.id, { name });
    setBusy(false);
    if (res.ok) {
      props.onSaved('Vehicle updated.');
    } else {
      window.alert(res.error.message);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Edit vehicle"
      className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border border-gray-200 bg-white p-4 shadow-xl"
    >
      <div className="mx-auto max-w-md">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Edit vehicle</h2>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md px-2 py-1 text-xs text-gray-500"
          >
            ✕
          </button>
        </div>
        <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="vehicle-name">
          Name
        </label>
        <input
          id="vehicle-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || !name.trim()}
          className="w-full rounded-md bg-gray-900 py-2 text-sm font-medium text-white disabled:bg-gray-400"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
