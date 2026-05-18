import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type {
  AppointmentCreateRequest,
  AppointmentMutationResponse,
  AppointmentOutput,
} from '@mygroomtime/shared';
import {
  cancelAppointment,
  createAppointment,
  updateAppointment,
} from '../../lib/appointments-api';

export type CalendarMutationsApi = {
  create: UseMutationResult<unknown, Error, AppointmentCreateRequest, unknown>;
  cancel: UseMutationResult<void, Error, string, unknown>;
  notes: UseMutationResult<
    AppointmentMutationResponse,
    Error,
    { id: string; notes: string },
    unknown
  >;
  reschedule: UseMutationResult<
    AppointmentMutationResponse,
    Error,
    { id: string; start: Date },
    { previous: AppointmentOutput[] | undefined }
  >;
};

type Args = {
  apptQueryKey: readonly unknown[];
  onToast: (msg: string) => void;
  onCloseSheet: () => void;
  onCloseDetail: () => void;
};

export function useCalendarMutations(args: Args): CalendarMutationsApi {
  const qc = useQueryClient();

  function refresh(): void {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
    void qc.invalidateQueries({ queryKey: ['appointment-buffers'] });
  }

  const create = useMutation({
    mutationFn: async (payload: AppointmentCreateRequest) => {
      const res = await createAppointment(payload);
      if (!res.ok) {
        const e = new Error(res.error.message);
        (e as Error & { status?: number }).status = res.error.status;
        throw e;
      }
      return res.data;
    },
    onSuccess: () => {
      refresh();
      args.onCloseSheet();
    },
    onError: (err) => {
      const status = (err as Error & { status?: number }).status;
      if (status === 409) args.onToast(err.message);
    },
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const res = await cancelAppointment(id);
      if (!res.ok) throw new Error(res.error.message);
    },
    onSuccess: () => {
      refresh();
      args.onCloseDetail();
    },
    onError: (err) => args.onToast((err as Error).message),
  });

  const notes = useMutation({
    mutationFn: async (vars: { id: string; notes: string }) => {
      const res = await updateAppointment(vars.id, { notes: vars.notes });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (err) => args.onToast((err as Error).message),
  });

  const reschedule = useMutation({
    mutationFn: async (vars: { id: string; start: Date }) => {
      const res = await updateAppointment(vars.id, { start: vars.start.toISOString() });
      if (!res.ok) {
        const e = new Error(res.error.message);
        (e as Error & { status?: number }).status = res.error.status;
        throw e;
      }
      return res.data;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['appointments'] });
      const previous = qc.getQueryData<AppointmentOutput[]>(args.apptQueryKey);
      if (previous) {
        const optimistic = previous.map((a) =>
          a.id === vars.id
            ? {
                ...a,
                start: vars.start.toISOString(),
                end: new Date(vars.start.getTime() + a.durationMin * 60_000).toISOString(),
              }
            : a,
        );
        qc.setQueryData(args.apptQueryKey, optimistic);
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(args.apptQueryKey, ctx.previous);
      args.onToast((err as Error).message);
    },
    onSuccess: () => {
      refresh();
    },
  });

  return { create, cancel, notes, reschedule };
}
