// why: the offline banner, the queued-mutations modal, and the replay runner all need to
// know when the queue contents change. A tiny pub/sub bus avoids prop-drilling and keeps
// these consumers decoupled from the queue storage layer.

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeToOfflineQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyOfflineQueueChanged(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // why: a buggy listener shouldn't stop the rest from updating.
    }
  }
}
