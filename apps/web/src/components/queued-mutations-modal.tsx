import { useOfflineQueue } from '../lib/use-offline-queue';
import { dequeue, type QueuedMutation } from '../lib/offline-queue';
import { notifyOfflineQueueChanged } from '../lib/offline-bus';

type Props = { onClose: () => void };

function describeConflict(m: QueuedMutation): string {
  if (m.conflictServerStatus == null) return 'Pending sync.';
  const body = m.conflictServerBody as { message?: string; reason?: string } | null;
  if (body?.message) return `Server ${m.conflictServerStatus}: ${body.message}`;
  if (body?.reason) return `Server ${m.conflictServerStatus}: ${body.reason}`;
  return `Server responded ${m.conflictServerStatus}.`;
}

function summarizeIntent(m: QueuedMutation): string {
  return `${m.method} ${m.endpoint}`;
}

export function QueuedMutationsModal({ onClose }: Props): JSX.Element {
  const state = useOfflineQueue();

  async function onDiscard(id: string): Promise<void> {
    await dequeue(id);
    notifyOfflineQueueChanged();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Queued changes"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-xl bg-white p-4 shadow-lg sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Pending changes</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-sm text-gray-600"
            aria-label="Close pending changes"
          >
            ✕
          </button>
        </div>
        {state.total === 0 ? (
          <p className="text-sm text-gray-600">Nothing queued.</p>
        ) : null}
        {state.conflicts.length > 0 ? (
          <section className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Needs attention
            </h3>
            <ul className="space-y-3">
              {state.conflicts.map((m) => (
                <li
                  key={m.id}
                  className="rounded-lg border border-gray-200 p-3 text-sm"
                  data-testid={`conflict-${m.id}`}
                >
                  <div className="mb-2 font-medium">{m.label}</div>
                  <div className="mb-1 text-xs text-gray-500">{summarizeIntent(m)}</div>
                  <div className="mb-3 text-xs text-gray-700">{describeConflict(m)}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void onDiscard(m.id)}
                      className="min-h-[36px] rounded-md border border-gray-300 px-3 text-xs font-medium text-gray-800"
                    >
                      Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {state.pending.length > 0 ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Queued
            </h3>
            <ul className="space-y-2">
              {state.pending.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <span>{m.label}</span>
                  <span className="text-xs text-gray-500">
                    {m.status === 'syncing' ? 'Sending…' : 'Pending'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
