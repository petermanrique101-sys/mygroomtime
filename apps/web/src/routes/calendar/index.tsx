import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  AppointmentOutput,
  ClientWithPetsOutput,
  ServiceOutput,
} from '@mygroomtime/shared';
import { useAuthOptional } from '../../lib/auth-context';
import { useLastSyncedLabel } from '../../lib/use-last-synced';
import { RouteView } from './route-view';
import { useRouteOptimization } from './use-route-optimization';
import { CompleteModal } from './complete-modal';
import { useLifecycle } from './use-lifecycle';
import { listClients, getClient } from '../../lib/clients-api';
import { listServices } from '../../lib/services-api';
import { getDayBuffers, listAppointments } from '../../lib/appointments-api';
import { useCalendarMutations } from './use-calendar-mutations';
import {
  formatHeaderLabel,
  rangeForView,
  snapToSlot,
  startOfDay,
  stepForView,
  type CalendarView,
} from './date-nav';
import { useViewMode } from './use-view-mode';
import { CalendarHeader } from './header';
import { DayView } from './day-view';
import { WeekView } from './week-view';
import { MonthView } from './month-view';
import { NewAppointmentSheet } from './new-appointment-sheet';
import { DetailDrawer } from './detail-drawer';
import { Toast } from './toast';
import {
  buildBufferLookup,
  computeNonDroppableZones,
  conflictToastMessage,
  findDropConflict,
  type ConflictCheck,
} from './drag-zones';

const APPT_KEY = (view: CalendarView, anchorIso: string): readonly unknown[] =>
  ['appointments', view, anchorIso] as const;

const BUFFER_KEY = (dayIso: string): readonly unknown[] => ['appointment-buffers', dayIso] as const;

export default function CalendarRoute(): JSX.Element {
  const auth = useAuthOptional();
  const session = auth?.session ?? null;
  const { view, setView } = useViewMode();
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetInitial, setSheetInitial] = useState<Date>(() => snapToSlot(new Date()));
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [showRoute, setShowRoute] = useState(false);
  const routeOpt = useRouteOptimization(anchor, (msg) => setToast(msg));
  const lifecycle = useLifecycle((msg) => setToast(msg));

  const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);
  const dayIso = useMemo(() => startOfDay(anchor).toISOString(), [anchor]);

  const apptQuery = useQuery({
    queryKey: APPT_KEY(view, range.from.toISOString()),
    queryFn: async () => {
      const res = await listAppointments(range.from.toISOString(), range.to.toISOString());
      if (!res.ok) throw new Error(res.error.message);
      return res.data.appointments;
    },
  });

  const buffersQuery = useQuery({
    queryKey: BUFFER_KEY(dayIso),
    enabled: view === 'day',
    queryFn: async () => {
      const res = await getDayBuffers(dayIso);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const clientsQuery = useQuery({
    queryKey: ['clients', 'list-for-calendar'],
    queryFn: async () => {
      const res = await listClients();
      if (!res.ok) throw new Error(res.error.message);
      return res.data.clients;
    },
  });

  const servicesQuery = useQuery({
    queryKey: ['services', 'active'],
    queryFn: async () => {
      const res = await listServices();
      if (!res.ok) throw new Error(res.error.message);
      return res.data.services;
    },
  });

  const clientsWithPetsQuery = useQuery({
    queryKey: ['clients', 'with-pets'],
    enabled: (clientsQuery.data?.length ?? 0) > 0,
    queryFn: async (): Promise<ClientWithPetsOutput[]> => {
      const ids = (clientsQuery.data ?? []).map((c) => c.id);
      const results: ClientWithPetsOutput[] = [];
      for (const id of ids) {
        const r = await getClient(id);
        if (r.ok) results.push(r.data.client);
      }
      return results;
    },
  });

  const apptQueryKey = useMemo(
    () => APPT_KEY(view, range.from.toISOString()),
    [view, range.from],
  );
  const lastSyncedLabel = useLastSyncedLabel(apptQuery);
  const mutations = useCalendarMutations({
    apptQueryKey,
    onToast: setToast,
    onCloseSheet: () => setSheetOpen(false),
    onCloseDetail: () => setOpenDetailId(null),
  });
  const createMut = mutations.create;
  const cancelMut = mutations.cancel;
  const notesMut = mutations.notes;
  const rescheduleMut = mutations.reschedule;

  const appointments: AppointmentOutput[] = apptQuery.data ?? [];
  const services: ServiceOutput[] = servicesQuery.data ?? [];
  const clientsWithPets: ClientWithPetsOutput[] = clientsWithPetsQuery.data ?? [];
  const buffers = useMemo(
    () => buildBufferLookup(buffersQuery.data?.buffers ?? []),
    [buffersQuery.data],
  );

  const validateProposal = useCallback(
    (id: string, proposedStart: Date): ConflictCheck => {
      const src = appointments.find((x) => x.id === id);
      if (!src) return { ok: true };
      const zones = computeNonDroppableZones({
        day: anchor,
        now,
        appointments,
        buffers,
        excludeId: id,
      });
      return findDropConflict({
        proposedStartMs: proposedStart.getTime(),
        durationMin: src.durationMin,
        excludeId: id,
        zones,
        nowMs: now.getTime(),
      });
    },
    [anchor, appointments, buffers, now],
  );

  const onMoveAttempt = useCallback(
    (id: string, proposedStart: Date, check: ConflictCheck): void => {
      if (!check.ok) {
        const msg = conflictToastMessage(check);
        if (msg) setToast(msg);
        return;
      }
      setNow(new Date());
      rescheduleMut.mutate({ id, start: proposedStart });
    },
    [rescheduleMut],
  );

  function nudge(dir: 1 | -1): void {
    setAnchor((d) => stepForView(view)(d, dir));
  }

  function openSheetAt(d: Date): void {
    setSheetInitial(d);
    setSheetOpen(true);
  }

  function openNewFromHeader(): void {
    const n = new Date();
    const base = startOfDay(anchor);
    base.setHours(n.getHours(), n.getMinutes(), 0, 0);
    openSheetAt(snapToSlot(base));
  }

  const selected = appointments.find((a) => a.id === openDetailId) ?? null;

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
        <CalendarHeader
          view={view}
          label={formatHeaderLabel(view, anchor)}
          onPrev={() => nudge(-1)}
          onToday={() => setAnchor(startOfDay(new Date()))}
          onNext={() => nudge(1)}
          onViewChange={setView}
          onNew={openNewFromHeader}
        />
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
          <div className="flex gap-2" role="tablist" aria-label="Calendar mode">
            <button
              type="button"
              role="tab"
              aria-selected={!showRoute}
              onClick={() => setShowRoute(false)}
              className={`min-h-[36px] rounded-lg px-3 text-sm font-medium ${
                !showRoute ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              Calendar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showRoute}
              onClick={() => setShowRoute(true)}
              className={`min-h-[36px] rounded-lg px-3 text-sm font-medium ${
                showRoute ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              Today&rsquo;s Route
            </button>
          </div>
          <div className="flex gap-3">
            <Link to="/dashboard" className="text-gray-600 underline">
              Dashboard
            </Link>
            <Link to="/clients" className="text-gray-600 underline">
              Clients
            </Link>
            <Link to="/settings/services" className="text-gray-600 underline">
              Settings
            </Link>
          </div>
        </div>
        <div className="flex-1 overflow-x-hidden overflow-y-auto pb-12">
          {showRoute ? (
            <RouteView
              route={routeOpt.route}
              tenantPlan={session?.tenant.plan ?? 'starter'}
              loading={routeOpt.optimize.isPending}
              applying={routeOpt.apply.isPending}
              error={routeOpt.routeError}
              onOptimize={() => routeOpt.optimize.mutate()}
              onApply={() => routeOpt.apply.mutate()}
              onToggleLock={(id, locked) => routeOpt.lock.mutate({ id, locked })}
              onBackToCalendar={() => setShowRoute(false)}
            />
          ) : apptQuery.isLoading ? (
            <p className="px-4 py-6 text-sm text-gray-500">Loading calendar…</p>
          ) : apptQuery.isError && !apptQuery.data ? (
            // why: when offline + no cache, the query is in error state and `data` is
            // undefined. Show a calm "Offline — no cached data yet" instead of the red
            // error string (which is alarming and tells the user nothing useful).
            <OfflineEmptyState
              message={(apptQuery.error as Error)?.message ?? null}
              onRetry={() => void apptQuery.refetch()}
            />
          ) : view === 'day' ? (
            <DayView
              day={anchor}
              appointments={appointments}
              buffers={buffers}
              now={now}
              onTapSlot={openSheetAt}
              onTapAppointment={(a) => setOpenDetailId(a.id)}
              onMoveAttempt={onMoveAttempt}
              validateProposal={validateProposal}
              onAnnounce={(msg) => setToast(msg)}
            />
          ) : view === 'week' ? (
            <WeekView
              anchor={anchor}
              appointments={appointments}
              onTapSlot={openSheetAt}
              onTapAppointment={(a) => setOpenDetailId(a.id)}
            />
          ) : (
            <MonthView
              anchor={anchor}
              appointments={appointments}
              onPickDay={(d) => {
                setView('day');
                setAnchor(startOfDay(d));
              }}
            />
          )}
          {lastSyncedLabel ? (
            <p className="px-4 py-2 text-center text-[11px] text-gray-500">
              {lastSyncedLabel}
            </p>
          ) : null}
        </div>

        <NewAppointmentSheet
          open={sheetOpen}
          initialStart={sheetInitial}
          clients={clientsWithPets}
          services={services}
          submitting={createMut.isPending}
          submitError={
            createMut.isError && (createMut.error as Error & { status?: number }).status !== 409
              ? (createMut.error as Error).message
              : null
          }
          onClose={() => setSheetOpen(false)}
          onSubmit={(payload) => createMut.mutate(payload)}
        />

        <DetailDrawer
          appointment={selected}
          onClose={() => setOpenDetailId(null)}
          onCancel={(id) => cancelMut.mutate(id)}
          onSaveNotes={async (id, notes) => {
            await notesMut.mutateAsync({ id, notes });
          }}
          onMarkOnTheWay={(id) => lifecycle.markStatus(id, 'on_the_way')}
          onMarkStarted={(id) => lifecycle.markStatus(id, 'started')}
          onMarkNoShow={(id) => lifecycle.markStatus(id, 'no_show')}
          onOpenComplete={(a) => {
            setOpenDetailId(null);
            lifecycle.openComplete(a);
          }}
          onOpenRebook={(a) => {
            setOpenDetailId(null);
            lifecycle.openRebook(a);
          }}
          onPauseSeries={(seriesId) => mutations.pauseSeries.mutate(seriesId)}
          onResumeSeries={(seriesId) => mutations.resumeSeries.mutate(seriesId)}
          busy={
            cancelMut.isPending ||
            notesMut.isPending ||
            mutations.pauseSeries.isPending ||
            mutations.resumeSeries.isPending ||
            lifecycle.busy
          }
        />

        {lifecycle.modalAppointment ? (
          <CompleteModal
            appointment={lifecycle.modalAppointment}
            defaultIntervalWeeks={6}
            busy={lifecycle.busy}
            completeError={lifecycle.completeError}
            rebookError={lifecycle.rebookError}
            rebookConflictMessage={lifecycle.rebookConflictMessage}
            onComplete={lifecycle.complete}
            onRebook={lifecycle.rebook}
            onClose={lifecycle.closeModal}
          />
        ) : null}

        <Toast message={toast} onDismiss={() => setToast(null)} />
      </div>
    </main>
  );
}

function OfflineEmptyState({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}): JSX.Element {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const text = offline
    ? 'Offline — no cached data yet.'
    : message ?? 'Could not load the calendar.';
  return (
    <div className="px-4 py-6 text-sm text-gray-700">
      <p className="mb-3">{text}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[40px] rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800"
      >
        Try again
      </button>
    </div>
  );
}
