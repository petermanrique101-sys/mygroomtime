import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AppointmentOutput,
  AppointmentRebookConflict,
} from '@mygroomtime/shared';
import {
  completeAppointmentApi,
  patchAppointmentStatus,
  rebookAppointment,
} from '../../lib/appointments-api';

export type LifecycleApi = {
  modalAppointment: AppointmentOutput | null;
  openComplete: (a: AppointmentOutput) => void;
  openRebook: (a: AppointmentOutput) => void;
  closeModal: () => void;
  markStatus: (id: string, status: 'on_the_way' | 'started' | 'no_show') => void;
  complete: (tipCents: number) => Promise<boolean>;
  rebook: (intervalWeeks: number) => Promise<boolean>;
  busy: boolean;
  completeError: string | null;
  rebookError: string | null;
  rebookConflictMessage: string | null;
};

export function useLifecycle(onToast: (msg: string) => void): LifecycleApi {
  const qc = useQueryClient();
  const [modalAppointment, setModalAppointment] = useState<AppointmentOutput | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [rebookError, setRebookError] = useState<string | null>(null);
  const [rebookConflictMessage, setRebookConflictMessage] = useState<string | null>(null);

  function refresh(): void {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
    void qc.invalidateQueries({ queryKey: ['appointment-buffers'] });
  }

  const statusMut = useMutation({
    mutationFn: async (args: {
      id: string;
      status: 'on_the_way' | 'started' | 'no_show';
    }) => {
      const res = await patchAppointmentStatus(args.id, { status: args.status });
      if (!res.ok) {
        const e = new Error(res.error.message);
        (e as Error & { status?: number }).status = res.error.status;
        throw e;
      }
      return res.data;
    },
    onSuccess: () => {
      refresh();
    },
    onError: (err) => onToast((err as Error).message),
  });

  const completeMut = useMutation({
    mutationFn: async (args: { id: string; tipCents: number }) => {
      const res = await completeAppointmentApi(args.id, { tipCents: args.tipCents });
      if (!res.ok) {
        const e = new Error(res.error.message);
        (e as Error & { status?: number }).status = res.error.status;
        throw e;
      }
      return res.data;
    },
    onSuccess: (data) => {
      setModalAppointment(data.appointment);
      refresh();
    },
  });

  const rebookMut = useMutation({
    mutationFn: async (args: { id: string; intervalWeeks: number }) => {
      const res = await rebookAppointment(args.id, { intervalWeeks: args.intervalWeeks });
      if (!res.ok) {
        const e = new Error(res.error.message) as Error & {
          status?: number;
          payload?: AppointmentRebookConflict;
        };
        e.status = res.error.status;
        throw e;
      }
      return res.data;
    },
    onSuccess: (data) => {
      const nextDate = new Date(data.nextAppointment.start).toLocaleDateString();
      onToast(
        `Rebooked for ${nextDate}${data.reusedSeries ? ' (existing series)' : ''}.`,
      );
      refresh();
    },
  });

  return {
    modalAppointment,
    openComplete: (a) => {
      setCompleteError(null);
      setRebookError(null);
      setRebookConflictMessage(null);
      setModalAppointment(a);
    },
    openRebook: (a) => {
      setCompleteError(null);
      setRebookError(null);
      setRebookConflictMessage(null);
      // why: appointment is already completed; we still mount the modal but start it
      // on the rebook step. The modal reads appointment.status === 'completed' to skip
      // the tip step. We model this by setting an internal flag below; for simplicity
      // route through the same modal — caller mounts CompleteModal which auto-detects.
      setModalAppointment(a);
    },
    closeModal: () => setModalAppointment(null),
    markStatus: (id, status) => statusMut.mutate({ id, status }),
    complete: async (tipCents) => {
      if (!modalAppointment) return false;
      setCompleteError(null);
      try {
        await completeMut.mutateAsync({ id: modalAppointment.id, tipCents });
        return true;
      } catch (err) {
        setCompleteError((err as Error).message);
        return false;
      }
    },
    rebook: async (intervalWeeks) => {
      if (!modalAppointment) return false;
      setRebookError(null);
      setRebookConflictMessage(null);
      try {
        await rebookMut.mutateAsync({ id: modalAppointment.id, intervalWeeks });
        return true;
      } catch (err) {
        const status = (err as Error & { status?: number }).status;
        if (status === 409) {
          setRebookConflictMessage(
            `That date is already booked or buffered.`,
          );
        } else {
          setRebookError((err as Error).message);
        }
        return false;
      }
    },
    busy: statusMut.isPending || completeMut.isPending || rebookMut.isPending,
    completeError,
    rebookError,
    rebookConflictMessage,
  };
}
