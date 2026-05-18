import { useState } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type {
  RouteApplyRequest,
  RouteApplyResponse,
  RouteOptimizeResponse,
} from '@mygroomtime/shared';
import { applyOptimizedRoute, getOptimizedRoute } from '../../lib/route-api';
import { updateAppointment } from '../../lib/appointments-api';
import { startOfDay } from './date-nav';

export type RouteOptimizationApi = {
  route: RouteOptimizeResponse | null;
  routeError: string | null;
  optimize: UseMutationResult<RouteOptimizeResponse, Error, void, unknown>;
  apply: UseMutationResult<RouteApplyResponse, Error, void, unknown>;
  lock: UseMutationResult<unknown, Error, { id: string; locked: boolean }, unknown>;
  clearRoute: () => void;
};

export function useRouteOptimization(
  anchor: Date,
  onToast: (msg: string) => void,
): RouteOptimizationApi {
  const qc = useQueryClient();
  const [route, setRoute] = useState<RouteOptimizeResponse | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const optimize = useMutation({
    mutationFn: async () => {
      const res = await getOptimizedRoute(startOfDay(anchor).toISOString());
      if (!res.ok) {
        const e = new Error(res.error.message);
        (e as Error & { status?: number }).status = res.error.status;
        throw e;
      }
      return res.data;
    },
    onSuccess: (data) => {
      setRoute(data);
      setRouteError(null);
    },
    onError: (err) => setRouteError((err as Error).message),
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!route) throw new Error('Optimize first.');
      const payload: RouteApplyRequest = {
        date: route.date,
        vehicleId: route.vehicleId,
        stops: route.stops.map((s) => ({
          appointmentId: s.appointmentId,
          startSuggested: s.startSuggested,
        })),
      };
      const res = await applyOptimizedRoute(payload);
      if (!res.ok) {
        const e = new Error(res.error.message);
        (e as Error & { status?: number }).status = res.error.status;
        throw e;
      }
      return res.data;
    },
    onSuccess: (data) => {
      onToast(`Applied ${data.applied} shift${data.applied === 1 ? '' : 's'}.`);
      setRoute(null);
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ['appointment-buffers'] });
    },
    onError: (err) => {
      const status = (err as Error & { status?: number }).status;
      if (status === 409) {
        onToast('Schedule changed since optimization — please re-run.');
      } else {
        onToast((err as Error).message);
      }
    },
  });

  const lock = useMutation({
    mutationFn: async (args: { id: string; locked: boolean }) => {
      const res = await updateAppointment(args.id, { timeLocked: args.locked });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      setRoute((r) => {
        if (!r) return r;
        return {
          ...r,
          stops: r.stops.map((s) =>
            s.appointmentId === vars.id ? { ...s, timeLocked: vars.locked } : s,
          ),
        };
      });
    },
    onError: (err) => onToast((err as Error).message),
  });

  function clearRoute(): void {
    setRoute(null);
    setRouteError(null);
  }

  return { route, routeError, optimize, apply, lock, clearRoute };
}
