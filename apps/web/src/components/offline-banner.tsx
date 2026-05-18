import { useEffect, useRef, useState } from 'react';
import { useOfflineQueue } from '../lib/use-offline-queue';
import { QueuedMutationsModal } from './queued-mutations-modal';

// why: neutral palette, non-alarming. Constitution forbids red or warning iconography for
// the offline state — the groomer is going to spend hours in dead zones and we don't want
// to terrify them every time. Gray, small footprint, top of the viewport, click-through
// to a modal for details.
export function OfflineBanner(): JSX.Element | null {
  const state = useOfflineQueue();
  const [modalOpen, setModalOpen] = useState(false);
  const [showAllCaughtUp, setShowAllCaughtUp] = useState(false);
  const prevTotalRef = useRef(state.total);

  useEffect(() => {
    if (prevTotalRef.current > 0 && state.total === 0 && state.online) {
      // why: only show "All caught up" when we're transitioning from "had work" to
      // "no work" while online. Don't show it on first mount or on plain idle.
      setShowAllCaughtUp(true);
      const t = setTimeout(() => setShowAllCaughtUp(false), 2_000);
      prevTotalRef.current = state.total;
      return () => clearTimeout(t);
    }
    prevTotalRef.current = state.total;
    return undefined;
  }, [state.online, state.total]);

  if (state.online && state.total === 0 && !showAllCaughtUp) return null;

  const label = (() => {
    if (!state.online) return `Offline — ${state.total} change${state.total === 1 ? '' : 's'} queued`;
    if (state.conflicts.length > 0) {
      return `${state.conflicts.length} change${state.conflicts.length === 1 ? '' : 's'} need${
        state.conflicts.length === 1 ? 's' : ''
      } attention`;
    }
    if (state.pending.length > 0) return `Syncing — ${state.pending.length} left`;
    return 'All caught up';
  })();

  const showLink = state.total > 0;

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        data-testid="offline-banner"
        className={`sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 transition-opacity ${
          state.online && state.total === 0 ? 'opacity-60' : 'opacity-100'
        }`}
      >
        <span>{label}</span>
        {showLink ? (
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-medium text-gray-800 underline"
            onClick={() => setModalOpen(true)}
          >
            Pending
          </button>
        ) : null}
      </div>
      {modalOpen ? <QueuedMutationsModal onClose={() => setModalOpen(false)} /> : null}
    </>
  );
}
