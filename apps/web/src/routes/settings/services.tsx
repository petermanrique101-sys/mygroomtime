import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServiceInput, ServiceOutput } from '@mygroomtime/shared';
import {
  createService,
  deleteService,
  listServices,
  restoreService,
  updateService,
} from '../../lib/services-api';
import { ServiceForm } from './service-form';
import { ServiceRow } from './service-row';
import { centsToDollarString } from './money';

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; service: ServiceOutput };

const QUERY_KEY = ['services', 'all'] as const;

export default function ServicesSettingsRoute(): JSX.Element {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [showDeleted, setShowDeleted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await listServices({ includeDeleted: true });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const services = query.data?.services ?? [];
  const active = useMemo(() => services.filter((s) => s.deletedAt === null), [services]);
  const deleted = useMemo(() => services.filter((s) => s.deletedAt !== null), [services]);

  const createMut = useMutation({
    mutationFn: async (input: ServiceInput) => {
      const res = await createService(input);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      setMode({ kind: 'list' });
      setSubmitError(null);
    },
    onError: (err) => setSubmitError((err as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: async (args: { id: string; input: ServiceInput }) => {
      const res = await updateService(args.id, args.input);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      setMode({ kind: 'list' });
      setSubmitError(null);
    },
    onError: (err) => setSubmitError((err as Error).message),
  });

  const toggleMut = useMutation({
    mutationFn: async (args: { id: string; active: boolean }) => {
      const res = await updateService(args.id, { active: args.active });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await deleteService(id);
      if (!res.ok) throw new Error(res.error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const restoreMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await restoreService(id);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  function handleSubmit(input: ServiceInput): void {
    if (mode.kind === 'new') createMut.mutate(input);
    else if (mode.kind === 'edit') updateMut.mutate({ id: mode.service.id, input });
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to="/settings" className="text-sm text-gray-600 underline">
              ← Settings
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Services</h1>
            <span className="w-12" />
          </div>
        </header>

        <div className="flex-1">
          {mode.kind === 'list' ? (
            <ListView
              loading={query.isLoading}
              error={query.isError ? (query.error as Error).message : null}
              services={active}
              deleted={deleted}
              showDeleted={showDeleted}
              onToggleShowDeleted={() => setShowDeleted((v) => !v)}
              onAdd={() => {
                setSubmitError(null);
                setMode({ kind: 'new' });
              }}
              onEdit={(s) => {
                setSubmitError(null);
                setMode({ kind: 'edit', service: s });
              }}
              onToggleActive={(s, next) => toggleMut.mutate({ id: s.id, active: next })}
              onDelete={(s) => deleteMut.mutate(s.id)}
              onRestore={(s) => restoreMut.mutate(s.id)}
            />
          ) : (
            <div className="px-4 py-5">
              <h2 className="mb-4 text-lg font-semibold tracking-tight">
                {mode.kind === 'new' ? 'New service' : `Edit ${mode.service.name}`}
              </h2>
              <ServiceForm
                initial={mode.kind === 'edit' ? mode.service : undefined}
                submitting={createMut.isPending || updateMut.isPending}
                submitError={submitError}
                onSubmit={handleSubmit}
                onCancel={() => {
                  setSubmitError(null);
                  setMode({ kind: 'list' });
                }}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

type ListProps = {
  loading: boolean;
  error: string | null;
  services: ServiceOutput[];
  deleted: ServiceOutput[];
  showDeleted: boolean;
  onToggleShowDeleted: () => void;
  onAdd: () => void;
  onEdit: (s: ServiceOutput) => void;
  onToggleActive: (s: ServiceOutput, next: boolean) => void;
  onDelete: (s: ServiceOutput) => void;
  onRestore: (s: ServiceOutput) => void;
};

function ListView({
  loading,
  error,
  services,
  deleted,
  showDeleted,
  onToggleShowDeleted,
  onAdd,
  onEdit,
  onToggleActive,
  onDelete,
  onRestore,
}: ListProps): JSX.Element {
  if (loading) return <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>;
  if (error) return <p className="px-4 py-6 text-sm text-red-600">{error}</p>;

  return (
    <div className="pb-12">
      <div className="px-4 py-4">
        <button
          type="button"
          onClick={onAdd}
          className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white"
        >
          + Add service
        </button>
      </div>
      {services.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">No services yet. Add your first one.</p>
      ) : (
        <ul>
          {services.map((s) => (
            <ServiceRow
              key={s.id}
              service={s}
              onEdit={() => onEdit(s)}
              onDelete={() => onDelete(s)}
              onToggleActive={(next) => onToggleActive(s, next)}
            />
          ))}
        </ul>
      )}

      {deleted.length > 0 ? (
        <section className="mt-6 border-t border-gray-100">
          <button
            type="button"
            onClick={onToggleShowDeleted}
            aria-expanded={showDeleted}
            className="flex min-h-[44px] w-full items-center justify-between px-4 text-sm font-medium text-gray-600"
          >
            <span>Deleted services ({deleted.length})</span>
            <span>{showDeleted ? '▾' : '▸'}</span>
          </button>
          {showDeleted ? (
            <ul>
              {deleted.map((s) => (
                <li key={s.id} className="border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span
                      aria-hidden="true"
                      className="inline-block h-5 w-5 shrink-0 rounded-full border border-gray-200 opacity-60"
                      style={{ backgroundColor: s.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-gray-500">{s.name}</div>
                      <div className="truncate text-xs text-gray-400">
                        {s.durationMin} min · ${centsToDollarString(s.basePriceCents)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRestore(s)}
                      className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-900"
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
