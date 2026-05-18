import { useEffect, useState } from 'react';
import { peekAll, type QueuedMutation } from './offline-queue';
import { subscribeToOfflineQueue } from './offline-bus';

export type OfflineQueueState = {
  online: boolean;
  pending: QueuedMutation[];
  conflicts: QueuedMutation[];
  total: number;
};

const EMPTY: QueuedMutation[] = [];

function getNavigatorOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function useOfflineQueue(): OfflineQueueState {
  const [online, setOnline] = useState<boolean>(() => getNavigatorOnline());
  const [rows, setRows] = useState<QueuedMutation[]>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      const all = await peekAll();
      if (!cancelled) setRows(all);
    }
    void refresh();
    const unsub = subscribeToOfflineQueue(() => {
      void refresh();
    });
    function onOnline(): void {
      setOnline(true);
    }
    function onOffline(): void {
      setOnline(false);
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      cancelled = true;
      unsub();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const pending = rows.filter((r) => r.status !== 'conflict');
  const conflicts = rows.filter((r) => r.status === 'conflict');
  return { online, pending, conflicts, total: rows.length };
}
